// Explicit fake IPC/catalog state-transition tests. No inference, downloads,
// installers, personal media or user settings are accessed. Timeout checks use
// Playwright's virtual clock; they do not wait 135 real seconds.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const {chromium}=await import(process.env.PLAYWRIGHT_PACKAGE?pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE,'index.mjs')).href:'playwright');
const compiled=await build({entryPoints:['shared/contracts.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(mod,mod.exports);const defaults=mod.exports.defaultPreferences;
const harness=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useModelDownloads,MODEL_CATALOG_TIMEOUT_MS} from './src/lib/useModelDownloads';
import {defaultPreferences} from './shared/contracts';
function Child({ready}){
 const models=useModelDownloads(ready,defaultPreferences.options);
 const snapshot={loading:models.loading,error:models.error,catalog:models.catalog,job:models.job};
 useEffect(()=>{window.__modelHook=models;window.__hookSnapshot=snapshot;});
 return <pre id="hook-state">{JSON.stringify(snapshot)}</pre>;
}
function Harness(){
 const [mounted,setMounted]=useState(true),[ready,setReady]=useState(true);
 useEffect(()=>{window.__hookControl={setMounted,setReady};window.__catalogTimeout=MODEL_CATALOG_TIMEOUT_MS;},[]);
 return mounted?<Child ready={ready}/>:<p id="unmounted">Unmounted</p>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
`},bundle:true,platform:'browser',format:'iife',write:false});
const harnessHtml=`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script>${harness.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
const url=process.env.UI_TEST_URL||'http://127.0.0.1:5184',artifacts=resolve('.test-output/model-catalog-state');await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];

async function fixture({hook=false,prefsFailure=false,prefsPending=false,runtimePending=false,runtimeFailure=false}={}){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(({defaults,prefsFailure,prefsPending,runtimePending,runtimeFailure})=>{
    let prefs={...defaults,onboardingDone:true,tutorialDone:true,autoUpdate:false,options:{...defaults.options,model:'image-small',maps:['depth']}};
    let runtime={ready:true,depthModelsReady:true,cloakReady:true,installing:false,progress:1,message:'EXPLICIT UI MOCK · no downloads'};
    const requests=[],runtimeCallbacks=new Set(),modelCallbacks=new Set();
    const makeCatalog=({ready=true,busy=false,tag='fresh'}={})=>({
      basicReady:ready,
      models:['image-small','video-small','alpha-fast','alpha-advanced','normal','appearance'].map(id=>({id,name:`FAKE ${id}`,ready:ready&&id.endsWith('small'),builtin:id.endsWith('small'),repo:tag,revision:'mock',license:'mock'})),
      ...(busy?{busy:{jobId:'obsolete-external-job',modelId:'alpha-fast'}}:{}),
    });
    window.__catalogMock={requests,calls:{prefs:0,runtime:0,system:0,download:0},
      settle:(id,options)=>{const request=requests.find(request=>request.id===id);if(!request)throw new Error(`No fake catalog request ${id}`);request.settled=true;request.resolve(makeCatalog(options));},
      fail:id=>{const request=requests.find(request=>request.id===id);request.settled=true;request.reject(new Error('FAKE catalog failure · network disabled'));},
      emitRuntime:patch=>{runtime={...runtime,...patch};for(const callback of runtimeCallbacks)callback(structuredClone(runtime));},
    };
    const calls=window.__catalogMock.calls,noopSubscription=()=>()=>{};
    window.depthdesk={
      getPreferences:()=>{calls.prefs++;return prefsFailure?Promise.reject(new Error('FAKE preference read failure')):prefsPending?new Promise(()=>{}):Promise.resolve(prefs);},
      setPreferences:async patch=>(prefs={...prefs,...patch}),
      getRuntime:()=>{calls.runtime++;return runtimeFailure?Promise.reject(new Error('FAKE runtime read failure')):runtimePending?new Promise(()=>{}):Promise.resolve(structuredClone(runtime));},
      onRuntime:callback=>{runtimeCallbacks.add(callback);return()=>runtimeCallbacks.delete(callback);},
      getSystem:async()=>{calls.system++;return{cuda:false,gpu:'EXPLICIT UI MOCK',vramGB:0,freeVramGB:0,torch:'mock',python:'mock',ffmpeg:true};},
      getModelCatalog:()=>new Promise((resolve,reject)=>requests.push({id:requests.length+1,resolve,reject,settled:false})),
      onModelProgress:callback=>{modelCallbacks.add(callback);return()=>modelCallbacks.delete(callback);},
      downloadModel:async()=>{calls.download++;throw new Error('No downloads permitted in this UI fixture');},cancelModelDownload:async()=>{},
      installRuntime:async()=>{throw new Error('No runtime installation permitted in this UI fixture');},
      getUpdateStatus:async()=>({status:'idle'}),checkForUpdates:async()=>{},downloadUpdate:async()=>{},installUpdate:async()=>{},onUpdate:noopSubscription,
      onProgress:noopSubscription,onCloakProgress:noopSubscription,onPlaybackProgress:noopSubscription,
      chooseVideo:async()=>null,chooseCloakFiles:async()=>[],chooseOutputDir:async()=>null,chooseSavePath:async()=>null,pasteClipboardImage:async()=>null,
      openFolder:async()=>{},revealFile:async()=>{},cancelJob:async()=>{},cancelCloakJob:async()=>{},cancelPlayback:async()=>{},
    };
  },{defaults,prefsFailure,prefsPending,runtimePending,runtimeFailure});
  if(hook)await page.route('**/__model-catalog-harness',route=>route.fulfill({status:200,contentType:'text/html',body:harnessHtml}));
  await page.goto(hook?`${url}/__model-catalog-harness`:url);
  if(hook)await page.waitForFunction(()=>window.__hookControl&&window.__hookSnapshot);
  else await page.locator('[aria-label="모델 설치 상태 다시 확인"]').waitFor({state:'attached'});
  return page;
}
const requestIds=page=>page.evaluate(()=>window.__catalogMock.requests.map(request=>request.id));
const latest=async page=>(await requestIds(page)).at(-1);
const settle=(page,id,options={})=>page.evaluate(({id,options})=>window.__catalogMock.settle(id,options),{id,options});
const waitRequests=(page,count)=>page.waitForFunction(count=>window.__catalogMock.requests.length>=count,count);
const retry=page=>page.locator('[aria-label="모델 설치 상태 다시 확인"]');
const depth=page=>page.locator('[aria-label="Depth 깊이 추출"]');
const waitReady=page=>page.waitForFunction(()=>!document.querySelector('[aria-label="Depth 깊이 추출"]').disabled&&!document.querySelector('[aria-label="모델 설치 상태 다시 확인"]').disabled);
const hookState=page=>page.evaluate(()=>window.__hookSnapshot);

try{
  const delayed=await fixture();await waitRequests(delayed,1);assert.equal(await retry(delayed).isDisabled(),true);assert.equal(await depth(delayed).isDisabled(),true);
  assert.ok((await delayed.locator('.map-availability').allTextContents()).some(text=>text.includes('설치 확인 중')));
  await settle(delayed,await latest(delayed));await waitReady(delayed);
  console.log('PASS delayed catalog: loading gates downloads/maps, resolved catalog restores controls.');await delayed.close();

  const timeout=await fixture();await waitRequests(timeout,1);const obsolete=await latest(timeout);
  await timeout.clock.fastForward(136000);await timeout.locator('.model-download-error').waitFor();assert.match(await timeout.locator('.model-download-error').innerText(),/시간.*초과/);assert.equal(await retry(timeout).isEnabled(),true);
  assert.ok((await timeout.locator('.map-availability').allTextContents()).every(text=>!text.includes('설치 확인 중')));
  await timeout.screenshot({path:resolve(artifacts,'catalog-timeout-recoverable.png')});
  await retry(timeout).click();await waitRequests(timeout,obsolete+1);await settle(timeout,await latest(timeout));await waitReady(timeout);
  await settle(timeout,obsolete,{ready:false,tag:'obsolete-timeout'});assert.equal(await depth(timeout).isEnabled(),true);assert.equal(await timeout.locator('.model-download-error').count(),0);
  console.log('PASS permanently pending catalog: virtual deadline clears loading, enables retry, accepts fresh result and ignores late old reply.');await timeout.close();

  const failed=await fixture();await waitRequests(failed,1);await failed.evaluate(()=>window.__catalogMock.fail(window.__catalogMock.requests.at(-1).id));await failed.locator('.model-download-error').waitFor();assert.equal(await retry(failed).isEnabled(),true);await retry(failed).click();await waitRequests(failed,2);await settle(failed,await latest(failed));await waitReady(failed);
  console.log('PASS rejected catalog: visible error and working retry, no permanent installation spinner.');await failed.close();

  const installing=await fixture();await waitRequests(installing,1);await settle(installing,await latest(installing));await waitReady(installing);const beforeInstall=(await requestIds(installing)).length;
  await installing.evaluate(()=>window.__catalogMock.emitRuntime({ready:true,installing:true,depthModelsReady:false,progress:.5}));await installing.waitForFunction(()=>document.querySelector('[aria-label="Depth 깊이 추출"]').disabled);
  await installing.evaluate(()=>window.__catalogMock.emitRuntime({ready:true,installing:false,depthModelsReady:true,progress:1}));await waitRequests(installing,beforeInstall+1);await settle(installing,await latest(installing));await waitReady(installing);
  console.log('PASS runtime remains ready=true across install: installing transition invalidates and completion refreshes catalog.');await installing.close();

  for(const mode of ['prefsFailure','prefsPending']){
    const prefs=await fixture({[mode]:true});await waitRequests(prefs,1);await settle(prefs,await latest(prefs));
    if(mode==='prefsPending')await prefs.clock.fastForward(31000);
    await prefs.locator('[role="dialog"]').waitFor();assert.equal(await depth(prefs).isDisabled(),false);assert.equal(await retry(prefs).isDisabled(),false);
    const calls=await prefs.evaluate(()=>window.__catalogMock.calls);assert.ok(calls.system>=1);assert.equal(calls.download,0);
    console.log(`PASS initial ${mode}: successful runtime/catalog survives preference failure/deadline; onboarding remains available.`);await prefs.close();
  }

  for(const mode of ['runtimeFailure','runtimePending']){
    const runtime=await fixture({[mode]:true});
    if(mode==='runtimePending')await runtime.clock.fastForward(136000);
    await runtime.locator('.error-banner').waitFor();assert.match(await runtime.locator('.error-banner').innerText(),mode==='runtimePending'?/실행 환경 확인 시간이 초과/:/FAKE runtime read failure/);
    assert.equal((await requestIds(runtime)).length,0);assert.equal(await runtime.getByRole('button',{name:'설치 / 다시 시도',exact:true}).isEnabled(),true);
    // Recover through a fresh runtime event, without executing the installer.
    await runtime.evaluate(()=>window.__catalogMock.emitRuntime({ready:true,installing:false,depthModelsReady:true}));await waitRequests(runtime,1);await settle(runtime,await latest(runtime));await waitReady(runtime);
    console.log(`PASS initial ${mode}: visible error, installer retry available, later runtime event starts a successful catalog check.`);await runtime.close();
  }

  const busy=await fixture();await waitRequests(busy,1);const firstBusy=await latest(busy);await settle(busy,firstBusy,{busy:true,tag:'stale-external'});await busy.clock.runFor(1100);await waitRequests(busy,firstBusy+1);await settle(busy,await latest(busy));await waitReady(busy);
  console.log('PASS stale busy catalog automatically rechecks and clears old external-job gate.');await busy.close();
  const stuckBusy=await fixture();await waitRequests(stuckBusy,1);await settle(stuckBusy,await latest(stuckBusy),{busy:true});await stuckBusy.clock.runFor(1100);await waitRequests(stuckBusy,2);await stuckBusy.clock.fastForward(135000);await stuckBusy.locator('.model-download-error').waitFor();assert.equal(await retry(stuckBusy).isEnabled(),true);
  console.log('PASS busy snapshot followed by pending recheck also expires with enabled retry.');await stuckBusy.close();

  const strict=await fixture({hook:true});await waitRequests(strict,2);const mounts=await requestIds(strict),fresh=mounts.at(-1);await settle(strict,fresh,{tag:'strict-fresh'});await strict.waitForFunction(()=>!window.__hookSnapshot.loading&&window.__hookSnapshot.catalog?.models[0].repo==='strict-fresh');
  for(const id of mounts.filter(id=>id!==fresh))await settle(strict,id,{ready:false,tag:'strict-cleaned-up'});
  assert.equal((await hookState(strict)).catalog.models[0].repo,'strict-fresh');assert.equal((await hookState(strict)).error,'');
  await strict.evaluate(()=>void window.__modelHook.refresh());const oldRefresh=await latest(strict);await strict.evaluate(()=>void window.__modelHook.refresh());const newRefresh=await latest(strict);assert.ok(newRefresh>oldRefresh);
  await settle(strict,newRefresh,{tag:'new-generation'});await strict.waitForFunction(()=>!window.__hookSnapshot.loading);await settle(strict,oldRefresh,{ready:false,tag:'old-generation'});assert.equal((await hookState(strict)).catalog.models[0].repo,'new-generation');
  await strict.evaluate(()=>void window.__modelHook.refresh());const disabledReply=await latest(strict);await strict.evaluate(()=>window.__hookControl.setReady(false));await strict.waitForFunction(()=>window.__hookSnapshot.catalog===null&&!window.__hookSnapshot.loading);await settle(strict,disabledReply,{tag:'engine-disabled'});assert.equal((await hookState(strict)).catalog,null);
  await strict.evaluate(()=>window.__hookControl.setReady(true));await waitRequests(strict,disabledReply+1);const unmountedReply=await latest(strict);await strict.evaluate(()=>window.__hookControl.setMounted(false));await strict.locator('#unmounted').waitFor();await strict.evaluate(id=>window.__catalogMock.fail(id),unmountedReply);
  await strict.evaluate(()=>window.__hookControl.setMounted(true));await waitRequests(strict,unmountedReply+2);await settle(strict,await latest(strict),{tag:'remounted-fresh'});await strict.waitForFunction(()=>!window.__hookSnapshot.loading&&window.__hookSnapshot.catalog?.models[0].repo==='remounted-fresh');
  console.log('PASS StrictMode cleanup/remount, concurrent refresh generations, engine-disable cancellation and late unmounted failure.');
  const timeoutMs=await strict.evaluate(()=>window.__catalogTimeout);await strict.evaluate(()=>void window.__modelHook.refresh());await strict.clock.fastForward(timeoutMs+1000);await strict.waitForFunction(()=>!window.__hookSnapshot.loading&&!!window.__hookSnapshot.error);assert.equal((await hookState(strict)).catalog,null);
  console.log(`PASS hook deadline uses actual production constant (${timeoutMs} ms) and clears stale readiness after failed check.`);await strict.close();
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
