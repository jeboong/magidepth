// Isolated browser component test. No app IPC, real files, installation or model downloads.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_PACKAGE?pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE,'index.mjs')).href:'playwright');
const encoded=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=30','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
assert.equal(encoded.status,0,encoded.error?.message||encoded.stderr?.toString());const videoFixture=encoded.stdout;
const fixture=`
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VideoTrimEditor} from './src/components/VideoTrimEditor';
window.__trimEvents={applies:[],seeks:[],plays:0};
window.__trimVideos=[];const createElement=document.createElement.bind(document);document.createElement=(tag,...args)=>{const element=createElement(tag,...args);if(tag==='video')window.__trimVideos.push(element);return element;};
const realPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__trimEvents.plays++;return realPlay.call(this);};
function Fixture(){
 const [source,setSource]=useState('/missing.mp4'),[duration,setDuration]=useState(10),[value,setValue]=useState(null),[currentTime,setCurrentTime]=useState(0),[disabled,setDisabled]=useState(false);
 useEffect(()=>{window.__trimFixture={changeSource:()=>setSource('/other.mp4'),setDisabled,useVideo:(url)=>{setDuration(1);setValue(null);setSource(url);}};},[]);
 return <VideoTrimEditor sourceUrl={source} duration={duration} fps={30} currentTime={currentTime} value={value} disabled={disabled} onSeek={time=>{window.__trimEvents.seeks.push(time);setCurrentTime(time);}} onApply={range=>{window.__trimEvents.applies.push(range);setValue(range);}}/>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const built=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,outfile:'fixture.js'});
const javascript=built.outputFiles.find(file=>file.path.endsWith('.js')).text,css=built.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
const server=createServer((request,response)=>{
  if(request.url==='/fixture.mp4'){const match=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=match?Number(match[1]):0,end=match&&match[2]?Math.min(videoFixture.length-1,Number(match[2])):videoFixture.length-1;response.writeHead(match?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${videoFixture.length}`}:{})});response.end(videoFixture.subarray(start,end+1));}
  else if(request.url==='/fixture.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(javascript);}
  else if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end(`<!doctype html><html><head><meta charset="UTF-8"><style>:root{--background:220 15% 10%;--foreground:220 10% 95%;--popover:220 15% 12%;--primary:78 50% 66%;--primary-foreground:80 30% 10%;--muted-foreground:220 8% 63%;--muted:220 10% 16%;--secondary:220 10% 14%;--border:220 10% 25%;--ring:78 50% 66%}*{box-sizing:border-box}body{margin:0;padding:30px;background:hsl(var(--background));font-family:Arial}button,input{font:inherit}button{cursor:pointer}#root{max-width:680px;margin:auto}button:not(.video-trim-handle){min-height:30px;border-radius:6px;color:hsl(var(--foreground));background:hsl(var(--secondary));border:1px solid hsl(var(--border));display:inline-flex;align-items:center;gap:5px}button svg{width:14px;height:14px}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);}
  else{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1040,height:720}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const open=()=>page.getByTestId('video-trim-open').click(),state=()=>page.evaluate(()=>window.__trimEvents);
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.getByTestId('video-trim-editor').count(),0);assert.equal(await page.locator('button').count(),1);
  await open();await page.getByText('썸네일 없이 구간을 선택할 수 있어요').waitFor();
  assert.deepEqual((await state()).applies,[]);
  const track=await page.locator('.video-trim-filmstrip').boundingBox(),handle=page.getByTestId('video-trim-start-handle'),box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(track.x+track.width*.2,box.y+box.height/2,{steps:12});await page.mouse.up();
  assert.ok(Number(await handle.getAttribute('aria-valuenow'))>1.8);assert.deepEqual((await state()).applies,[]);
  await handle.focus();await page.keyboard.press('End');assert.ok(Math.abs(Number(await handle.getAttribute('aria-valuenow'))-299/30)<.0001);
  await page.getByTestId('video-trim-end-handle').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.getByTestId('video-trim-end-handle').getAttribute('aria-valuenow'),'10');
  await page.getByTestId('video-trim-apply').click();assert.equal((await state()).applies.length,1);assert.deepEqual((await state()).applies[0],{start:299/30,end:10});
  await open();await handle.focus();await page.keyboard.press('Shift+ArrowLeft');await page.getByTestId('video-trim-cancel').click();assert.equal((await state()).applies.length,1);
  await open();await page.getByTestId('video-trim-reset').click();assert.equal((await state()).applies.at(-1),null);
  await open();await handle.focus();await page.keyboard.press('ArrowRight');await page.evaluate(()=>window.__trimFixture.changeSource());await page.getByTestId('video-trim-open').waitFor();assert.equal((await state()).applies.length,2);
  await open();assert.equal(await handle.getAttribute('aria-valuenow'),'0');
  const cancelled=await handle.boundingBox();await page.mouse.move(cancelled.x+cancelled.width/2,cancelled.y+cancelled.height/2);await page.mouse.down();await page.mouse.move(cancelled.x+120,cancelled.y+cancelled.height/2,{steps:5});
  await handle.evaluate(element=>element.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));await page.mouse.up();assert.equal(await handle.getAttribute('aria-valuenow'),'0');assert.equal((await state()).applies.length,2);
  await page.keyboard.press('Escape');await page.getByTestId('video-trim-open').waitFor();
  await page.evaluate(()=>window.__trimFixture.setDisabled(true));await page.waitForFunction(()=>document.querySelector('[data-testid="video-trim-open"]').disabled);assert.equal(await page.getByTestId('video-trim-open').isDisabled(),true);await page.evaluate(()=>window.__trimFixture.setDisabled(false));
  // A synthetic one-second MP4 is generated in memory; no personal media or files.
  await page.evaluate(()=>window.__trimFixture.useVideo('/fixture.mp4'));
  await open();try{await page.waitForFunction(()=>document.querySelectorAll('.video-trim-thumbnails img').length===12,{},{timeout:15000});}catch(error){throw new Error(`${error.message}; filmstrip: ${await page.locator('#root').innerText()}; state: ${await page.getByTestId('video-trim-editor').getAttribute('data-thumbnail-state')}; thumbnails: ${await page.locator('.video-trim-thumbnails img').count()}; videos: ${JSON.stringify(await page.evaluate(()=>window.__trimVideos.map(video=>({src:video.src,ready:video.readyState,duration:video.duration,current:video.currentTime,error:video.error?.message}))))}`);}
  assert.equal((await state()).plays,0);assert.ok((await state()).seeks.every(time=>time>=0&&time<=10-1/30));
  await page.setViewportSize({width:480,height:720});
  const editor=await page.getByTestId('video-trim-editor').boundingBox();assert.ok(editor.x>=0&&editor.x+editor.width<=480);
  const apply=await page.getByTestId('video-trim-apply').boundingBox();assert.ok(apply.y+apply.height<=720);
  await page.getByTestId('video-trim-cancel').click();assert.deepEqual(errors,[]);
  console.log('PASS VideoTrimEditor: optional draft, frame bounds, pointer drag/cancel, keyboard, apply/cancel/reset, source reset, disabled, thumbnail fallback/real decoding, no autoplay, compact layout.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
