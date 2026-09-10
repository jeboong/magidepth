/* Hidden, application-owned Electron integration smoke test.
 * Requires `npm run build` and the provisioned .test-runtime/data engine.
 * No real file dialogs, Explorer windows, personal media, or model inference are used.
 */
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const data = process.env.DEPTHDESK_TEST_USER_DATA || path.join(root, '.test-runtime', 'data');

if (!process.versions.electron) {
  const env = {...process.env, DEPTHDESK_TEST_USER_DATA:data};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DEPTHDESK_DEV_URL;
  const child = spawn(require('electron'), [__filename], {cwd:root, env, windowsHide:true, stdio:'inherit'});
  child.once('error', error => { console.error('FAIL Electron launch:',error.message); process.exitCode=1; });
  child.once('exit', (code,signal) => { if(signal)console.error('Electron test interrupted:',signal); process.exitCode=code??1; });
} else {
  void run();
}

async function run() {
  const {app, BrowserWindow, dialog, clipboard, ClipboardItem, shell, net} = require('electron');
  const prefsPath=path.join(data,'preferences.json');
  const fixtureDir=path.join(data,'integration-fixtures',new Date().toISOString().replace(/[:.]/g,'-'));
  const outputDir=path.join(fixtureDir,'output');
  const tests=[];
  let win;
  let originalPrefs;
  let prefsExisted=false;
  let clipboardBackup;
  let clipboardChanged=false;
  let failure;
  const fatalTimer=setTimeout(()=>{console.error('FAIL Electron integration exceeded 120 seconds');app.quit();setTimeout(()=>app.exit(1),1000);},120000);
  const opened=[];
  const revealed=[];
  const openResponses=[];
  const saveResponses=[];
  const dialogCalls=[];
  async function check(name,fn){const start=Date.now();await fn();tests.push({name,ms:Date.now()-start});console.log(`PASS ${name} (${Date.now()-start} ms)`);}
  async function renderer(fn,...args){return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);}
  async function api(method,...args){return renderer((method,args)=>window.depthdesk[method](...args),method,args);}
  try {
    // Do not yield before loading the main module: privileged schemes must register before app.ready.
    fsSync.mkdirSync(outputDir,{recursive:true});
    try{originalPrefs=fsSync.readFileSync(prefsPath);prefsExisted=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    // Only the app-path lookup is redirected; the production main/preload/IPC run unchanged.
    app.getAppPath=()=>root;
    assert.equal(app.getAppPath(),root);
    process.env.DEPTHDESK_TEST_USER_DATA=data;
    delete process.env.DEPTHDESK_DEV_URL;
    dialog.showOpenDialog=async(_window,options)=>{dialogCalls.push({kind:'open',properties:options.properties});const answer=openResponses.shift();assert.ok(answer,'Unexpected open dialog');return answer;};
    dialog.showSaveDialog=async(_window,options)=>{dialogCalls.push({kind:'save',defaultPath:options.defaultPath});const answer=saveResponses.shift();assert.ok(answer,'Unexpected save dialog');return answer;};
    dialog.showMessageBoxSync=()=>1;
    dialog.showErrorBox=(_title,content)=>{failure=new Error(`Application startup error: ${content}`);console.error(failure.message);};
    shell.openPath=async target=>{opened.push(target);return '';};
    shell.showItemInFolder=target=>{revealed.push(target);};
    // Prevent even a brief native window flash. BrowserWindow itself still runs normally.
    BrowserWindow.prototype.show=function(){};
    BrowserWindow.prototype.showInactive=function(){};
    const loaded=new Promise((resolve,reject)=>{
      app.once('browser-window-created',(_event,window)=>{
        win=window;
        window.webContents.once('did-finish-load',resolve);
        window.webContents.once('did-fail-load',(_e,code,description)=>reject(new Error(`Renderer load failed: ${code} ${description}`)));
      });
    });
    require(path.join(root,'app-desktop','main.cjs'));
    await loaded;
    if(failure)throw failure;
    await check('production preload API and renderer isolation',async()=>{
      assert.equal(win.isVisible(),false);
      assert.equal(win.webContents.getURL(),'depthdesk://app/index.html');
      const prefs=win.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);
      const result=await renderer(()=>({require:typeof require,process:typeof process,api:typeof window.depthdesk,render:typeof window.depthdesk?.render,clipboard:typeof window.depthdesk?.pasteClipboardImage}));
      assert.deepEqual(result,{require:'undefined',process:'undefined',api:'object',render:'function',clipboard:'function'});
    });
    await check('runtime readiness and system IPC',async()=>{
      const runtime=await api('getRuntime');assert.equal(runtime.ready,true, runtime.message);
      const system=await api('getSystem');assert.equal(system.ffmpeg,true);assert.ok(system.python);assert.ok(system.torch);
      assert.equal(typeof system.cuda,'boolean');
      console.log(`INFO Electron ${process.versions.electron}; Python ${system.python}; PyTorch ${system.torch}; CUDA available ${system.cuda}`);
    });
    const ffmpeg=path.join(data,'tools','bin','ffmpeg.exe');
    const png=path.join(fixtureDir,'synthetic.png');
    const mp4=path.join(fixtureDir,'synthetic.mp4');
    const hidden=path.join(fixtureDir,'unregistered.png');
    for(const args of [
      ['-f','lavfi','-i','testsrc2=size=96x64:rate=1','-frames:v','1',png],
      ['-f','lavfi','-i','testsrc2=size=320x180:rate=12','-t','2','-c:v','libx264','-pix_fmt','yuv420p',mp4],
    ]){const child=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,encoding:'utf8'});assert.equal(child.status,0,child.stderr);}
    const pngBytes=await fs.readFile(png);const originalHash=crypto.createHash('sha256').update(pngBytes).digest('hex');await fs.copyFile(png,hidden);
    await check('file/folder/Save As dialogs through mocked native boundaries',async()=>{
      openResponses.push({canceled:false,filePaths:[png]});assert.equal(await api('chooseVideo'),png);
      openResponses.push({canceled:true,filePaths:[]});assert.equal(await api('chooseVideo'),null);
      openResponses.push({canceled:false,filePaths:[outputDir]});assert.equal(await api('chooseOutputDir'),outputDir);
      const saveFile=path.join(outputDir,'saved.png');saveResponses.push({canceled:false,filePath:saveFile});assert.equal(await api('chooseSavePath',saveFile),saveFile);
      saveResponses.push({canceled:true});assert.equal(await api('chooseSavePath',saveFile),null);
      assert.ok(dialogCalls.some(v=>v.properties?.includes('openDirectory')));
      assert.ok(dialogCalls.some(v=>v.kind==='save'&&v.defaultPath===saveFile));
    });
    let basePrefs;
    await check('preferences validation and disk persistence',async()=>{
      basePrefs=await api('getPreferences');const options={...basePrefs.options,maps:['source'],previewMap:'source',device:'cpu',processingMode:'fast'};
      const changed=await api('setPreferences',{theme:'light',tutorialDone:true,autoUpdate:false,outputDir,options});
      assert.equal(changed.theme,'light');assert.equal(changed.outputDir,outputDir);assert.deepEqual(changed.options.maps,['source']);
      const disk=JSON.parse(await fs.readFile(prefsPath,'utf8'));assert.equal(disk.theme,'light');assert.deepEqual(disk.options.maps,['source']);
      assert.deepEqual((await api('getPreferences')).options.maps,['source']);
    });
    await check('synthetic image/video metadata and protected local media protocol',async()=>{
      const image=await api('probeVideo',png);assert.equal(image.kind,'image');assert.equal(image.width,96);assert.equal(image.height,64);
      const video=await api('probeVideo',mp4);assert.equal(video.kind,'video');assert.equal(video.width,320);assert.equal(video.fps,12);assert.equal(video.frames,24);
      // The app intentionally uses image/video elements, not cross-origin fetch, for local assets.
      const decoded=await renderer(path=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('Registered media image failed to decode'));img.src=`depthdesk-media://local/?path=${encodeURIComponent(path)}`;}),png);
      assert.deepEqual(decoded,{width:96,height:64});
      const status=await net.fetch(`depthdesk-media://local/?path=${encodeURIComponent(png)}`);assert.equal(status.status,200);assert.ok((await status.arrayBuffer()).byteLength>0);
      const denied=await net.fetch(`depthdesk-media://local/?path=${encodeURIComponent(hidden)}`);assert.equal(denied.status,403);
    });
    const options={...basePrefs.options,maps:['source'],previewMap:'source',device:'cpu',processingMode:'fast',outputSize:'source'};
    await check('source-only image/video frame previews without model inference',async()=>{
      for(const source of [png,mp4]){
        const result=await api('preview',{jobId:`preview-${crypto.randomUUID()}`,path:source,time:0.5,options});
        assert.match(result.source,/^data:image\/(png|jpeg);base64,/);assert.match(result.image,/^data:image\/(png|jpeg);base64,/);assert.ok(result.images.source);assert.ok(result.width>0);assert.ok(result.height>0);
      }
    });
    let imageOutput;
    let videoOutput;
    await check('source-only image and trimmed video exports',async()=>{
      imageOutput=await api('render',{jobId:`render-${crypto.randomUUID()}`,path:png,trimStart:0,trimEnd:1,outputPath:path.join(outputDir,'image.png'),options});
      assert.ok((await fs.stat(imageOutput.outputPath)).size>0);assert.equal(imageOutput.frames,1);assert.ok(imageOutput.outputPaths.source);
      videoOutput=await api('render',{jobId:`render-${crypto.randomUUID()}`,path:mp4,trimStart:0.5,trimEnd:1.5,outputPath:path.join(outputDir,'video.mp4'),options});
      assert.ok((await fs.stat(videoOutput.outputPath)).size>0);assert.equal(videoOutput.frames,12);assert.ok(videoOutput.outputPaths.source);
      const exported=await api('probeVideo',videoOutput.outputPath);assert.equal(exported.kind,'video');assert.equal(exported.frames,12);
      assert.equal(crypto.createHash('sha256').update(await fs.readFile(png)).digest('hex'),originalHash);
      await api('openFolder',outputDir);await api('revealFile',imageOutput.outputPath);assert.deepEqual(opened,[outputDir]);assert.deepEqual(revealed,[imageOutput.outputPath]);
    });
    await check('invalid path, overwrite protection, and job cancellation',async()=>{
      await assert.rejects(()=>api('probeVideo',path.join(fixtureDir,'missing.png')));
      await assert.rejects(()=>api('render',{jobId:`render-${crypto.randomUUID()}`,path:png,trimStart:0,trimEnd:1,outputPath:png,options}),/덮어쓸/);
      await assert.rejects(()=>api('cancelJob',123),/Invalid job/);
      // Regression: cancellation must be remembered while the main process is
      // still awaiting source-path validation, before the daemon sees the job.
      const earlyJobId=`render-${crypto.randomUUID()}`;
      await renderer(request=>{window.__testEarlyCancelledRender=window.depthdesk.render(request).then(value=>({ok:true,value}),error=>({ok:false,error:String(error)}));return true;},{jobId:earlyJobId,path:mp4,trimStart:0,trimEnd:2,outputPath:path.join(outputDir,'early-cancelled.mp4'),options});
      await api('cancelJob',earlyJobId);
      const earlyCancelled=await renderer(()=>window.__testEarlyCancelledRender);assert.equal(earlyCancelled.ok,false,'Immediate cancellation before worker registration should reject the render');assert.match(earlyCancelled.error,/cancel|취소/i);
      await assert.rejects(()=>fs.stat(path.join(outputDir,'early-cancelled.mp4')),error=>error.code==='ENOENT');
      const jobId=`render-${crypto.randomUUID()}`;
      await renderer(request=>{let sent=false;const off=window.depthdesk.onProgress(event=>{if(event.jobId===request.jobId&&!sent){sent=true;void window.depthdesk.cancelJob(request.jobId);}});window.__testCancelledRender=window.depthdesk.render(request).then(value=>({ok:true,value}),error=>({ok:false,error:String(error)})).finally(off);return true;},{jobId,path:mp4,trimStart:0,trimEnd:2,outputPath:path.join(outputDir,'cancelled.mp4'),options});
      const cancelled=await renderer(()=>window.__testCancelledRender);assert.equal(cancelled.ok,false,'Cancellation should reject the queued/active render');assert.match(cancelled.error,/cancel|취소/i);
      await assert.rejects(()=>fs.stat(path.join(outputDir,'cancelled.mp4')),error=>error.code==='ENOENT');
      // A cancelled job must not prevent the next request from reaching the worker.
      assert.equal((await api('probeVideo',png)).kind,'image');
    });
    await check('clipboard PNG import with original clipboard fully restored',async()=>{
      // Materialize every original representation before writing; print no clipboard contents.
      const original=await clipboard.read();
      clipboardBackup=[];
      for(const item of original){const entries=[];for(const type of item.types)entries.push([type,await item.getType(type)]);clipboardBackup.push(new ClipboardItem(Object.fromEntries(entries)));}
      clipboardChanged=true;
      try{
        await clipboard.write([new ClipboardItem({'image/png':new Blob([pngBytes],{type:'image/png'})})]);
        const pasted=await api('pasteClipboardImage');assert.ok(pasted?.endsWith('.png'));const info=await api('probeVideo',pasted);assert.equal(info.kind,'image');assert.equal(info.width,96);assert.equal(info.height,64);
      }finally{if(clipboardBackup.length)await clipboard.write(clipboardBackup);else clipboard.clear();clipboardChanged=false;}
    });
    await check('development update event through preload subscription',async()=>{
      await renderer(()=>{window.__testUpdate=null;window.__testUnsubscribe=window.depthdesk.onUpdate(value=>{window.__testUpdate=value;});});
      await api('checkForUpdates');const update=await renderer(()=>{window.__testUnsubscribe();return window.__testUpdate;});assert.equal(update.status,'up-to-date');
    });
    console.log(`PASS ALL ${tests.length} Electron integration checks. No AI models loaded; all fixture media is synthetic.`);
    await fs.writeFile(path.join(fixtureDir,'integration-report.json'),JSON.stringify({ok:true,electron:process.versions.electron,tests},null,2));
  } catch(error){failure=error;console.error('FAIL Electron integration:',error.stack||error.message);}
  finally{
    clearTimeout(fatalTimer);
    if(clipboardChanged){try{if(clipboardBackup?.length)await clipboard.write(clipboardBackup);else clipboard.clear();}catch(error){failure??=error;console.error('FAIL clipboard restoration:',error.message);}}
    try{if(prefsExisted)await fs.writeFile(prefsPath,originalPrefs);else await fs.rm(prefsPath,{force:true});}catch(error){failure??=error;console.error('FAIL preferences restoration:',error.message);}
    // Run the production worker/runtime cleanup, then exit with a deterministic test code.
    app.emit('before-quit',{preventDefault(){}});
    app.exit(failure?1:0);
  }
}
