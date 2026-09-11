// App integration UI regression, with an explicitly FAKE backend/model catalog.
// No inference, model downloads, installer execution or personal media is used.
// Run against an isolated Vite: UI_TEST_URL=http://127.0.0.1:5184.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_PACKAGE?pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE,'index.mjs')).href:'playwright');
const compiled=await build({entryPoints:['shared/contracts.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);const defaults=module.exports.defaultPreferences;
const artifacts=resolve('.test-output/depth-workflow');await mkdir(artifacts,{recursive:true});
const encoded=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',resolve(artifacts,'synthetic-motion.mp4')]);
assert.equal(encoded.status,0,encoded.error?.message||encoded.stderr?.toString());
const fragmented=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);assert.equal(fragmented.status,0,fragmented.stderr?.toString());const offsetData='data:video/mp4;base64,'+fragmented.stdout.toString('base64');
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
const url=process.env.UI_TEST_URL||'http://127.0.0.1:5184';
const videoData=`${url}/.test-output/depth-workflow/synthetic-motion.mp4`;
async function fixture({proxy=false,offset=false}={}){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({defaults,videoData,offsetData,proxy,offset})=>{
    // The browser fixture has no Electron protocol handler. Map only this one
    // mocked depthdesk-media URL to the same-origin HTTP file with byte ranges.
    const protocolUrl=`depthdesk-media://local/?path=${encodeURIComponent(videoData)}`,mapSource=value=>value===protocolUrl?videoData:value;
    const src=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');Object.defineProperty(HTMLMediaElement.prototype,'src',{...src,set(value){src.set.call(this,mapSource(value));}});
    const setAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){return setAttribute.call(this,name,this instanceof HTMLMediaElement&&name==='src'?mapSource(value):value);};
    let prefs={...defaults,outputDir:'C:\\UI-TEST-NO-WRITES',onboardingDone:true,tutorialDone:true,autoUpdate:false,options:{...defaults.options,model:'image-small',maps:['depth']}};
    const original=proxy?'data:video/quicktime;base64,AAAA':offset?offsetData:videoData;
    const models=['image-small','video-small','alpha-fast','alpha-advanced','normal','appearance'].map(id=>({id,name:`FAKE ${id}`,ready:id.endsWith('small'),builtin:id.endsWith('small'),repo:'EXPLICIT UI MOCK',revision:'mock',license:'mock'}));
    const catalog=()=>({models:structuredClone(models),basicReady:models.filter(model=>model.builtin).every(model=>model.ready)});
    const subscribers=new Set(),downloads=new Map();
    const svg=(color)=>'data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><circle cx="160" cy="90" r="40" fill="#a0b4bf"/></svg>`);
    const mock={renders:[],previews:[],downloads:[],cancels:[],playbacks:[],original,prefs:()=>prefs,
      emit:(progress=.4)=>{for(const [jobId,task]of downloads)for(const callback of subscribers)callback({jobId,modelId:task.modelId,stage:'download',progress,message:'FAKE DOWNLOAD · network disabled'});},
      succeed:()=>{for(const [id,task]of downloads){models.find(model=>model.id===task.modelId).ready=true;downloads.delete(id);task.resolve(catalog());}},
      fail:()=>{for(const [id,task]of downloads){downloads.delete(id);task.reject(new Error('FAKE DOWNLOAD FAILURE · 실제 다운로드 없음'));}},
    };
    window.__depthWorkflowMock=mock;
    mock.mediaEvents=[];for(const type of ['seeking','seeked','loadedmetadata','loadeddata','error','waiting','stalled'])document.addEventListener(type,event=>{const video=event.target;if(video instanceof HTMLVideoElement&&video.classList.contains('source-video'))mock.mediaEvents.push({type,time:video.currentTime,ready:video.readyState});},true);
    window.depthdesk={
      getPreferences:async()=>prefs,setPreferences:async patch=>(prefs={...prefs,...patch}),
      chooseVideo:async()=>original,getFilePath:()=>original,pasteClipboardImage:async()=>null,
      probeVideo:async path=>({kind:'video',path,name:proxy?'synthetic-codec-fixture.mov':'synthetic-motion-fixture.mp4',width:320,height:180,fps:30,frames:60,duration:2,hasAudio:false}),
      preparePlayback:async request=>{mock.playbacks.push(request);return{path:videoData,proxy:true,cached:false};},cancelPlayback:async()=>{},onPlaybackProgress:()=>()=>{},
      preview:async request=>{mock.previews.push(request);return{source:svg('#8a7373'),image:svg('#a0a0a0'),images:{source:svg('#8a7373'),depth:svg('#a0a0a0'),normal:svg('#779abb'),alpha:svg('#fff')},frame:Math.round(request.time*30),width:320,height:180,elapsed:0};},
      render:async request=>{mock.renders.push(request);return{outputPath:'C:\\UI-TEST-NO-WRITES\\synthetic_depth.mp4',outputPaths:{depth:'C:\\UI-TEST-NO-WRITES\\synthetic_depth.mp4'},frames:Math.round((request.trimEnd-request.trimStart)*30),elapsed:0,fps:0};},cancelJob:async()=>{},
      getModelCatalog:async()=>catalog(),downloadModel:request=>{mock.downloads.push(request);return new Promise((resolve,reject)=>downloads.set(request.jobId,{...request,resolve,reject}));},
      cancelModelDownload:async jobId=>{mock.cancels.push(jobId);const task=downloads.get(jobId);downloads.delete(jobId);task?.reject(new Error('FAKE DOWNLOAD CANCELLED'));},onModelProgress:callback=>{subscribers.add(callback);return()=>subscribers.delete(callback);},
      chooseOutputDir:async()=>null,chooseSavePath:async()=>null,openFolder:async()=>{},revealFile:async()=>{},
      getRuntime:async()=>({ready:true,depthModelsReady:true,cloakReady:true,installing:false,progress:1,message:'EXPLICIT UI MOCK · no inference/download'}),installRuntime:async()=>{throw new Error('Unexpected real runtime install request');},
      getSystem:async()=>({cuda:false,gpu:'EXPLICIT UI MOCK',vramGB:0,freeVramGB:0,torch:'mock',python:'mock',ffmpeg:true}),
      getUpdateStatus:async()=>({status:'idle'}),checkForUpdates:async()=>{},downloadUpdate:async()=>{},installUpdate:async()=>{},onProgress:()=>()=>{},onRuntime:()=>()=>{},onUpdate:()=>()=>{},
      onCloakProgress:()=>()=>{},chooseCloakFiles:async()=>[],cancelCloakJob:async()=>{},
    };
  },{defaults,videoData,offsetData,proxy,offset});
  await page.goto(url);try{await page.getByRole('heading',{name:'MagiDepth',exact:true}).waitFor();}catch(error){throw new Error(`${error.message}; page errors: ${errors.join('; ')}; body: ${(await page.locator('body').innerText()).slice(0,2000)}`);}
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Depth 깊이 추출"]').disabled);
  return page;
}
const inspect=page=>page.evaluate(()=>({renders:window.__depthWorkflowMock.renders,previews:window.__depthWorkflowMock.previews,downloads:window.__depthWorkflowMock.downloads,cancels:window.__depthWorkflowMock.cancels,playbacks:window.__depthWorkflowMock.playbacks,prefs:window.__depthWorkflowMock.prefs(),original:window.__depthWorkflowMock.original}));
const render=page=>page.getByRole('button',{name:/^\d+개 맵 영상 내보내기$/}).click();
async function seekKey(page,key){const slider=page.getByRole('slider',{name:'재생 위치',exact:true});await slider.focus();await slider.press(key);await page.waitForFunction(()=>{const video=document.querySelector('video.source-video');return video&&video.readyState>=2&&!video.seeking;});}
async function pixels(page){return page.locator('video.source-video').evaluate(video=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;const context=canvas.getContext('2d');context.drawImage(video,0,0,64,36);let hash=0;for(const value of context.getImageData(0,0,64,36).data)hash=(hash*31+value)>>>0;return{hash,time:video.currentTime,hidden:video.classList.contains('media-hidden')};});}
try{
  const page=await fixture();await page.getByRole('button',{name:'파일 선택',exact:true}).click();await page.getByText('synthetic-motion-fixture.mp4',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('video.source-video')?.readyState>=2);
  assert.equal(await page.getByTestId('video-trim-editor').count(),0);
  await render(page);let result=await inspect(page);assert.equal(result.renders.length,1);assert.equal(result.renders[0].trimStart,0);assert.equal(result.renders[0].trimEnd,2);
  await page.getByTestId('video-trim-open').click();await page.getByRole('spinbutton',{name:'자르기 시작 초',exact:true}).fill('.5');await page.getByRole('spinbutton',{name:'자르기 시작 초',exact:true}).press('Enter');
  await render(page);result=await inspect(page);assert.equal(result.renders.at(-1).trimStart,0);assert.equal(result.renders.at(-1).trimEnd,2);
  await page.getByTestId('video-trim-cancel').click();await page.getByTestId('video-trim-open').click();assert.equal(Number(await page.getByRole('spinbutton',{name:'자르기 시작 초',exact:true}).inputValue()),0);
  await page.getByRole('spinbutton',{name:'자르기 시작 초',exact:true}).fill('.4');await page.getByRole('spinbutton',{name:'자르기 종료 초',exact:true}).fill('1.5');await page.getByTestId('video-trim-apply').click();await render(page);result=await inspect(page);assert.equal(result.renders.at(-1).trimStart,.4);assert.equal(result.renders.at(-1).trimEnd,1.5);
  const playbackSlider=page.getByRole('slider',{name:'재생 위치',exact:true});
  await page.getByTestId('video-trim-applied').waitFor();
  assert.match(await page.getByTestId('video-trim-applied').innerText(),/00:00.400 — 00:01.500 · 선택 구간만 재생/);
  assert.equal(await page.getByTestId('video-trim-open').innerText(),'자르기 수정');
  assert.ok(Math.abs(Number(await playbackSlider.getAttribute('aria-valuemax'))-32/30)<.001);
  await seekKey(page,'Home');assert.ok(Math.abs((await pixels(page)).time-.4)<.002);
  assert.equal(Number(await playbackSlider.getAttribute('aria-valuenow')),0);
  assert.equal(await page.getByRole('button',{name:'이전 프레임',exact:true}).isDisabled(),true);
  await seekKey(page,'End');assert.ok(Math.abs((await pixels(page)).time-44/30)<.002);
  await seekKey(page,'ArrowRight');assert.ok(Math.abs((await pixels(page)).time-44/30)<.002);
  assert.equal(await page.getByRole('button',{name:'다음 프레임',exact:true}).isDisabled(),true);
  // Pointer dragging beyond either edge cannot enter removed footage.
  const sliderBox=await page.getByTestId('playback-timeline').boundingBox();assert.ok(sliderBox);
  await page.mouse.click(sliderBox.x+1,sliderBox.y+sliderBox.height/2);
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.seeking&&Math.abs(v.currentTime-.4)<.002;});
  await page.mouse.click(sliderBox.x+sliderBox.width-1,sliderBox.y+sliderBox.height/2);
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.seeking&&Math.abs(v.currentTime-44/30)<.002;});
  // Play at the selected end restarts the selection, then automatically stops.
  await page.getByRole('button',{name:'원본 재생',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.paused&&v.currentTime>=.4&&v.currentTime<1;});
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return v.paused&&!v.seeking&&Math.abs(v.currentTime-44/30)<.002;});
  await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Space');
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.paused&&v.currentTime>=.4&&v.currentTime<1;});
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return v.paused&&!v.seeking&&Math.abs(v.currentTime-44/30)<.002;});
  await page.screenshot({path:resolve(artifacts,'00-trim-applied-dark.png')});
  await page.getByRole('button',{name:'테마 전환',exact:true}).click();
  await page.screenshot({path:resolve(artifacts,'00-trim-applied-light.png')});
  await page.getByRole('button',{name:'테마 전환',exact:true}).click();
  // Re-edit deliberately exposes the original; cancel restores applied bounds.
  await page.getByTestId('video-trim-open').click();await seekKey(page,'End');assert.ok((await pixels(page)).time>1.9);
  await page.getByTestId('video-trim-cancel').click();
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.seeking&&Math.abs(v.currentTime-44/30)<.002;});
  await page.getByTestId('video-trim-open').click();await seekKey(page,'Home');
  assert.ok((await pixels(page)).time<.002,JSON.stringify(await page.evaluate(()=>({time:document.querySelector('video.source-video').currentTime,slider:document.querySelector('[data-testid="playback-timeline"]').outerHTML,focus:document.activeElement?.outerHTML,events:window.__depthWorkflowMock.mediaEvents.slice(-8)}))));
  await page.getByTestId('video-trim-cancel').click();
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.seeking&&Math.abs(v.currentTime-.4)<.002;});
  // A new selection outside the old bounds must not use a stale seek clamp.
  await page.getByTestId('video-trim-open').click();
  await page.getByRole('spinbutton',{name:'자르기 시작 초',exact:true}).fill('.1');
  await page.getByRole('spinbutton',{name:'자르기 종료 초',exact:true}).fill('.3');await page.getByTestId('video-trim-apply').click();
  await page.waitForFunction(()=>{const v=document.querySelector('video.source-video');return !v.seeking&&Math.abs(v.currentTime-.1)<.002;});
  await seekKey(page,'End');assert.ok(Math.abs((await pixels(page)).time-8/30)<.002);
  // A single-frame selection has no movable seek thumb and cannot yield NaN layout.
  await page.getByTestId('video-trim-open').click();
  await page.getByRole('spinbutton',{name:'자르기 종료 초',exact:true}).fill(String(4/30));await page.getByTestId('video-trim-apply').click();
  assert.equal(await playbackSlider.getAttribute('data-disabled'),'');
  assert.equal(Number(await playbackSlider.getAttribute('aria-valuenow')),0);
  assert.equal(await page.locator('.timeline').evaluate(node=>node.innerHTML.includes('NaN')),false);
  await page.getByTestId('video-trim-clear').click();
  assert.equal(await page.getByTestId('video-trim-applied').count(),0);
  await seekKey(page,'Home');assert.ok((await pixels(page)).time<.002);
  await seekKey(page,'End');assert.ok((await pixels(page)).time>1.9);
  console.log('PASS App applied trim: visible badge, relative seek bounds, pointer/keyboard limits, automatic stop/replay, re-edit/cancel, changed ranges, single frame, full restoration.');
  await page.getByTestId('video-trim-open').click();await page.getByTestId('video-trim-reset').click();await render(page);result=await inspect(page);assert.equal(result.renders.at(-1).trimStart,0);assert.equal(result.renders.at(-1).trimEnd,2);
  console.log('PASS App optional trim: full export default, draft does not change payload, cancel, applied export, full restore.');
  await page.getByTestId('video-trim-open').click();await page.waitForFunction(()=>{const editor=document.querySelector('[data-video-trim-editor]');return editor?.dataset.thumbnailState==='ready'&&Number(getComputedStyle(editor).opacity)>.99;});await page.getByTestId('video-trim-apply').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(artifacts,'01-video-trim-dark.png')});await page.getByTestId('video-trim-editor').screenshot({path:resolve(artifacts,'01b-video-trim-detail-dark.png')});await page.getByRole('button',{name:'테마 전환',exact:true}).click();await page.screenshot({path:resolve(artifacts,'01c-video-trim-light.png')});await page.getByTestId('video-trim-editor').screenshot({path:resolve(artifacts,'01d-video-trim-detail-light.png')});await page.setViewportSize({width:1040,height:720});await page.getByTestId('video-trim-apply').scrollIntoViewIfNeeded();assert.equal(await page.getByTestId('video-trim-apply').evaluate(button=>{const rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight&&button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(artifacts,'01e-video-trim-compact-light.png')});await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'테마 전환',exact:true}).click();await page.getByTestId('video-trim-cancel').click();

  await seekKey(page,'Home');const beginning=await pixels(page);await seekKey(page,'End');const ending=await pixels(page);assert.ok(ending.time>1.9);assert.notEqual(beginning.hash,ending.hash);assert.equal(ending.hidden,false);
  await seekKey(page,'Home');await seekKey(page,'ArrowRight');const oneFrame=await pixels(page);assert.ok(Math.abs(oneFrame.time-1/30)<.002,`slider key was intercepted: ${oneFrame.time}`);
  await page.getByRole('button',{name:'프레임 미리보기',exact:true}).click();await page.locator('.compare-viewport').waitFor();assert.equal((await pixels(page)).hidden,true);
  await seekKey(page,'End');assert.equal(await page.locator('.compare-viewport').count(),0);assert.equal((await pixels(page)).hidden,false);assert.equal((await inspect(page)).previews.length,1);
  await page.getByTestId('video-trim-open').click();const handle=page.getByTestId('video-trim-start-handle');await handle.press('ArrowRight');assert.ok(Math.abs(Number(await handle.getAttribute('aria-valuenow'))-1/30)<.002);try{await page.waitForFunction(()=>{const video=document.querySelector('video.source-video');return !video.seeking&&Math.abs(video.currentTime-1/30)<.002;},null,{timeout:5000});}catch(error){throw new Error(`${error.message}; seek state: ${JSON.stringify(await page.evaluate(()=>{const video=document.querySelector('video.source-video'),ranges=range=>Array.from({length:range.length},(_,index)=>[range.start(index),range.end(index)]);return {time:video.currentTime,seeking:video.seeking,ready:video.readyState,seekable:ranges(video.seekable),buffered:ranges(video.buffered),error:video.error?.message,thumbnail:document.querySelector('[data-testid="video-trim-editor"]').dataset.thumbnailState,events:window.__depthWorkflowMock.mediaEvents.slice(-12),slider:document.querySelector('.timeline-track [role="slider"]').getAttribute('aria-valuenow'),handle:document.querySelector('[data-testid="video-trim-start-handle"]').getAttribute('aria-valuenow')};}))}; errors: ${errors.join(';')}`);}const beforeButton=await pixels(page);await page.getByTestId('video-trim-cancel').focus();await page.keyboard.press('ArrowRight');const afterButton=await pixels(page);assert.ok(Math.abs(afterButton.time-beforeButton.time)<.002,`trim button key intercepted: ${beforeButton.time} -> ${afterButton.time}`);await page.getByTestId('video-trim-cancel').click();
  assert.equal((await inspect(page)).playbacks.length,0);
  console.log('PASS App actual synthetic-video pixels/currentTime scrub; comparison still switches to source; slider/trim keys are not intercepted.');

  const alpha=page.getByRole('checkbox',{name:'Alpha 피사체 마스크 추출'}),alphaDownload=page.getByRole('button',{name:'Alpha 모델 다운로드',exact:true});
  assert.equal(await alpha.isDisabled(),true);assert.equal(await alpha.getAttribute('aria-checked'),'false');assert.equal(await alphaDownload.isEnabled(),true);
  await alphaDownload.click();await page.getByRole('button',{name:'다운로드 취소',exact:true}).waitFor();await page.evaluate(()=>window.__depthWorkflowMock.emit(.42));await page.waitForFunction(()=>document.querySelector('[aria-label="모델 다운로드 진행률"]')?.getAttribute('aria-valuenow')==='42');
  await page.evaluate(()=>window.__depthWorkflowMock.fail());await page.getByText('FAKE DOWNLOAD FAILURE · 실제 다운로드 없음',{exact:true}).waitFor();assert.equal(await alpha.isDisabled(),true);assert.equal(await alpha.getAttribute('aria-checked'),'false');
  await alphaDownload.click();await page.getByRole('button',{name:'다운로드 취소',exact:true}).click();await page.getByText('FAKE DOWNLOAD CANCELLED',{exact:true}).waitFor();assert.equal(await alpha.isDisabled(),true);assert.equal(await alpha.getAttribute('aria-checked'),'false');
  await alphaDownload.click();await page.evaluate(()=>window.__depthWorkflowMock.succeed());await page.waitForFunction(()=>!document.querySelector('[aria-label="Alpha 피사체 마스크 추출"]').disabled);assert.equal(await alpha.getAttribute('aria-checked'),'false');await alpha.click();assert.equal(await alpha.getAttribute('aria-checked'),'true');
  const normal=page.getByRole('checkbox',{name:'Normal 표면 방향 추출'}),base=page.getByRole('checkbox',{name:'Base Color 기본 색상 추출'});await normal.click();await base.click();assert.equal(await normal.getAttribute('aria-checked'),'true');
  await page.getByRole('button',{name:'고급 AI',exact:true}).click();await page.waitForFunction(()=>window.__depthWorkflowMock.prefs().options.maps.join() === 'depth');
  assert.equal(await alpha.isDisabled(),true);assert.equal(await alpha.getAttribute('aria-checked'),'false');assert.equal(await normal.isDisabled(),true);assert.equal(await normal.getAttribute('aria-checked'),'false');assert.equal(await base.isDisabled(),true);
  await page.getByRole('button',{name:'Normal 모델 다운로드',exact:true}).click();assert.equal((await inspect(page)).downloads.at(-1).modelId,'normal');await page.evaluate(()=>window.__depthWorkflowMock.succeed());await page.waitForFunction(()=>!document.querySelector('[aria-label="Normal 표면 방향 추출"]').disabled);assert.equal(await normal.getAttribute('aria-checked'),'false');await normal.click();assert.equal(await normal.getAttribute('aria-checked'),'true');
  await page.screenshot({path:resolve(artifacts,'02-model-download-gating-dark.png')});await page.getByRole('button',{name:'테마 전환',exact:true}).click();await page.screenshot({path:resolve(artifacts,'03-model-download-gating-light.png')});
  console.log('PASS App explicit fake model catalog/download: missing maps gated, progress, failure/cancel stay unchecked, success requires manual selection, advanced switch deselects unavailable maps.');

  const proxy=await fixture({proxy:true});await proxy.getByRole('button',{name:'파일 선택',exact:true}).click();await proxy.getByText('호환 미리보기 · 원본과 내보내기 품질은 그대로',{exact:true}).waitFor();await proxy.waitForFunction(()=>document.querySelector('video.source-video')?.readyState>=2);
  await seekKey(proxy,'End');assert.equal((await pixels(proxy)).hidden,false);await render(proxy);const proxied=await inspect(proxy);assert.equal(proxied.playbacks.length,1);assert.equal(proxied.renders[0].path,proxied.original);assert.notEqual(await proxy.locator('video.source-video').getAttribute('src'),proxied.original);
  console.log('PASS App fake proxy preparation uses a real playable MP4 for display while export retains the original path.');
  const offset=await fixture({offset:true});await offset.getByRole('button',{name:'파일 선택',exact:true}).click();await offset.waitForFunction(()=>document.querySelector('video.source-video')?.readyState>=2);await seekKey(offset,'End');const beforeSnap=await pixels(offset);await offset.getByTestId('video-trim-open').click();await offset.getByTestId('video-trim-start-handle').press('ArrowRight');await offset.waitForFunction(()=>{const video=document.querySelector('video.source-video');return !video.seeking&&video.readyState>=2;},null,{timeout:5000});const snapped=await pixels(offset);assert.ok(Math.abs(snapped.time-1/30)<=1/30+1e-5,`unexpected timestamp snap ${snapped.time}`);assert.notEqual(beforeSnap.hash,snapped.hash);assert.ok(await offset.evaluate(()=>window.__depthWorkflowMock.mediaEvents.filter(event=>event.type==='seeking').length<20));
  console.log('PASS App offset/fragmented MP4 early-frame seek accepts browser timestamp snapping without repeated seek loops.');
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
