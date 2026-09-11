// Dedicated headless UI smoke. Run against Vite with UI_TEST_URL and optionally
// PLAYWRIGHT_PACKAGE pointing to the bundled Playwright package. No real installs.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const packagePath=process.env.PLAYWRIGHT_PACKAGE;
const {chromium}=await import(packagePath?pathToFileURL(resolve(packagePath,'index.mjs')).href:'playwright');
const compiled=await build({entryPoints:['shared/contracts.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const defaults=module.exports.defaultPreferences;
const url=process.env.UI_TEST_URL||'http://127.0.0.1:5183';
const out=resolve('.test-output/onboarding');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const failures=[];let count=0;
async function fixture({ready=false,cloakReady=false,done=false,theme='dark',width=1440,height=1000}={}){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',error=>failures.push(error.message));
  await page.addInitScript(({defaults,ready,cloakReady,done,theme})=>{
    let prefs=JSON.parse(localStorage.getItem('onboard-fixture-prefs')||JSON.stringify({...defaults,onboardingDone:done,tutorialDone:false,theme}));
    const callbacks=new Set();
    let runtime={ready,cloakReady,installing:false,progress:ready||cloakReady?1:0,message:'테스트 환경 · 실제 설치 없음'};
    const mock={calls:[],installs:[],prefs:()=>prefs,runtime:()=>runtime,finish:null,emit:update=>{runtime={...runtime,...update};for(const callback of callbacks)callback({...runtime});}};
    window.__onboardingMock=mock;
    window.depthdesk={
      getPreferences:async()=>prefs,setPreferences:async update=>{prefs={...prefs,...update};localStorage.setItem('onboard-fixture-prefs',JSON.stringify(prefs));mock.calls.push('preferences');return prefs;},
      getRuntime:async()=>runtime,onRuntime:callback=>{callbacks.add(callback);return()=>callbacks.delete(callback);},
      installRuntime:scope=>{mock.installs.push(scope);mock.emit({installing:true,error:undefined,progress:.02,message:'필요한 구성 확인 중'});return new Promise(resolve=>{mock.finish=success=>{mock.emit(success?{ready:scope==='depth'||runtime.ready,cloakReady:true,installing:false,progress:1,error:undefined,message:'검증 완료'}:{installing:false,error:'테스트 연결 오류',message:'다시 시도할 수 있습니다.'});resolve(runtime);};});},
      getSystem:async()=>({cuda:false,gpu:'TEST',vramGB:0,freeVramGB:0,torch:'TEST',python:'3.13',ffmpeg:true}),
      onProgress:()=>()=>{},onUpdate:()=>()=>{},onCloakProgress:()=>()=>{},
      chooseVideo:async()=>{mock.calls.push('choose');return null;},chooseCloakFiles:async()=>{mock.calls.push('cloak-choose');return[];},pasteClipboardImage:async()=>{mock.calls.push('paste');return null;},
      getFilePath:()=>'',checkForUpdates:async()=>{},installUpdate:async()=>{},
    };
  },{defaults,ready,cloakReady,done,theme});
  await page.goto(url);await page.locator('.app-shell').waitFor();
  if(!done){await page.getByTestId('onboarding-welcome-next').click();await page.getByRole('heading',{name:'어느 쪽 마법을 꺼낼까요?'}).waitFor();}
  return page;
}
const half=(page,side)=>page.getByTestId(`onboarding-${side}-half`);
const screenshot=(page,name)=>page.screenshot({path:resolve(out,`${name}.png`)});
const prefs=page=>page.evaluate(()=>window.__onboardingMock.prefs());
async function check(name,fn){await fn();count++;console.log(`PASS ${name}`);}
try{
  await check('video-derived alpha mascot; distinct selected overlays on both face halves',async()=>{
    const page=await fixture();
    await page.waitForFunction(()=>document.querySelector('[data-testid="onboarding-mascot"]')?.dataset.state==='ready');
    assert.equal(await page.getByTestId('onboarding-mascot').locator('canvas').evaluate(canvas=>getComputedStyle(canvas).transform),'none');
    assert.equal(await page.getByTestId('onboarding-next').isDisabled(),true);
    await screenshot(page,'01-choose');
    await half(page,'depth').hover();await page.waitForTimeout(180);
    const leftHover=await half(page,'depth').locator('.onboarding-half-frame').evaluate(element=>getComputedStyle(element).borderTopColor);assert.notEqual(leftHover,'rgba(0, 0, 0, 0)');
    await screenshot(page,'02-left-hover');
    await half(page,'depth').click();assert.equal(await half(page,'depth').getAttribute('aria-checked'),'true');assert.equal(await half(page,'cloak').getAttribute('aria-checked'),'false');await screenshot(page,'03-left-selected');
    await half(page,'cloak').hover();await page.waitForTimeout(180);
    const rightHover=await half(page,'cloak').locator('.onboarding-half-frame').evaluate(element=>getComputedStyle(element).borderTopColor);assert.notEqual(rightHover,'rgba(0, 0, 0, 0)');assert.notEqual(leftHover,rightHover);
    await screenshot(page,'04-right-hover');
    await half(page,'cloak').click();assert.equal(await half(page,'cloak').getAttribute('aria-checked'),'true');assert.equal(await half(page,'depth').getAttribute('aria-checked'),'false');await screenshot(page,'05-right-selected');
    await page.close();
  });
  await check('keyboard selection and modal guard block workspace shortcuts, paste and tutorial overlap',async()=>{
    const page=await fixture();await half(page,'depth').focus();await page.keyboard.press('ArrowRight');assert.equal(await half(page,'cloak').getAttribute('aria-checked'),'true');assert.equal(await half(page,'cloak').evaluate(element=>element===document.activeElement),true);
    await page.keyboard.press('ArrowLeft');assert.equal(await half(page,'depth').getAttribute('aria-checked'),'true');
    await page.keyboard.press('Control+o');await page.keyboard.press('Control+v');
    assert.deepEqual(await page.evaluate(()=>window.__onboardingMock.calls),[]);
    assert.equal(await page.locator('.app-shell').evaluate(element=>element.inert),true);assert.equal(await page.getByRole('dialog').count(),1);
    await page.close();
  });
  for(const selected of ['depth','cloak'])await check(`installed ${selected} skips setup/download and persists module independently of tutorialDone`,async()=>{
    const page=await fixture({ready:true,cloakReady:true});await half(page,selected).click();await page.getByTestId('onboarding-next').click();await page.locator('.onboarding-modal').waitFor({state:'hidden'});
    const saved=await prefs(page);assert.equal(saved.onboardingDone,true);assert.equal(saved.startupWorkspace,selected);assert.equal(saved.tutorialDone,false);
    assert.deepEqual(await page.evaluate(()=>window.__onboardingMock.installs),[]);assert.equal(await page.getByRole('tab',{name:selected==='depth'?'MagiDepth':'MagiCloak',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.getByRole('dialog').count(),0);
    // Preserve independent tutorial state; mark it done only in this fixture so
    // reload tests onboarding persistence without invoking the old tutorial.
    await page.evaluate(()=>window.depthdesk.setPreferences({tutorialDone:true}));await page.reload();await page.getByRole('heading',{name:selected==='depth'?'MagiDepth':'MagiCloak',exact:true}).waitFor();assert.equal(await page.locator('.onboarding-modal').count(),0);
    await page.close();
  });
  await check('missing Depth explains cost/deferred models; later opens workspace without install',async()=>{
    const page=await fixture();await half(page,'depth').click();await page.getByTestId('onboarding-next').click();
    await page.getByText('MagiMagic 사용을 위해 최초 1회 셋업이 필요합니다. 인터넷 환경과 PC 성능에 따라 수십 분 이상 소요될 수 있습니다.',{exact:true}).waitFor();
    await page.getByText('깊이·고급 AI 모델은 해당 모델을 처음 사용할 때 별도로 다운로드됩니다.',{exact:false}).waitFor();await screenshot(page,'06-depth-setup');
    await page.getByRole('button',{name:'나중에 준비',exact:true}).click();await page.locator('.onboarding-modal').waitFor({state:'hidden'});assert.equal((await prefs(page)).onboardingDone,true);assert.deepEqual(await page.evaluate(()=>window.__onboardingMock.installs),[]);await page.close();
  });
  await check('lightweight Cloak setup progress, failure, retry and success open workspace',async()=>{
    const page=await fixture();await half(page,'cloak').click();await page.getByTestId('onboarding-next').click();await page.getByText('PyTorch/CUDA는 설치하지 않습니다.',{exact:false}).waitFor();await page.getByRole('button',{name:'셋업 시작',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__onboardingMock.installs),['cloak']);await page.evaluate(()=>window.__onboardingMock.emit({progress:.42,message:'OpenCV 구성 요소를 준비합니다.'}));
    await page.getByRole('progressbar').waitFor();assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'42');await screenshot(page,'07-setup-progress');
    await page.evaluate(()=>window.__onboardingMock.finish(false));await page.locator('.onboarding-modal').getByText('테스트 연결 오류',{exact:true}).waitFor();await screenshot(page,'08-setup-error');
    await page.getByRole('button',{name:'다시 시도',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__onboardingMock.installs),['cloak','cloak']);await page.evaluate(()=>window.__onboardingMock.finish(true));await page.getByRole('heading',{name:'준비 끝. 이제 꺼내 쓰세요.'}).waitFor();await screenshot(page,'09-setup-ready');
    await page.getByRole('button',{name:'작업실 열기',exact:true}).click();await page.locator('.onboarding-modal').waitFor({state:'hidden'});assert.equal((await prefs(page)).startupWorkspace,'cloak');await page.close();
  });
  await check('browse during install keeps background setup running and remembers selection',async()=>{
    const page=await fixture();await half(page,'cloak').click();await page.getByTestId('onboarding-next').click();await page.getByRole('button',{name:'셋업 시작',exact:true}).click();await page.getByRole('button',{name:'설치 중 작업실 둘러보기',exact:true}).click();await page.locator('.onboarding-modal').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__onboardingMock.runtime().installing),true);assert.equal((await prefs(page)).startupWorkspace,'cloak');await page.evaluate(()=>window.__onboardingMock.finish(true));await page.close();
  });
  await check('Settings reopens picker; light theme and compact viewport remain usable',async()=>{
    const page=await fixture({ready:true,cloakReady:true,theme:'light',width:1040,height:720});await screenshot(page,'10-light-compact');
    const bounds=await page.locator('.onboarding-modal').boundingBox();assert.ok(bounds.y>=0);assert.ok(bounds.y+bounds.height<=720);
    await half(page,'cloak').click();await page.getByTestId('onboarding-next').click();await page.locator('.onboarding-modal').waitFor({state:'hidden'});await page.getByRole('button',{name:'앱 설정',exact:true}).click();await page.getByRole('button',{name:'MagiMagic 기능 다시 선택',exact:true}).click();await page.locator('.onboarding-modal').waitFor();await page.getByTestId('onboarding-welcome-next').click();assert.equal(await half(page,'cloak').getAttribute('aria-checked'),'true');assert.equal(await page.getByRole('dialog').count(),1);await screenshot(page,'11-picker-reopened');await page.getByRole('button',{name:'기능 선택 닫기',exact:true}).click();await page.locator('.onboarding-modal').waitFor({state:'hidden'});await page.close();
  });
  assert.deepEqual(failures,[]);console.log(`PASS ${count} onboarding UI scenarios; no browser exceptions. Screenshots: ${out}`);
}finally{await browser.close();}
