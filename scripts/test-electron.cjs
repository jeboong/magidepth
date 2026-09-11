/* Hidden, application-owned Electron integration smoke test.
 * Requires `npm run build` and the provisioned .test-runtime/data engine.
 * Optional: MAGIDEPTH_PACKAGED_DIR points to win-unpacked or an installed app
 * directory. The harness then loads the actual app.asar and packaged resources.
 * Network is off by default. MAGIDEPTH_TEST_UPDATE_FEED=1 additionally checks the
 * published packaged feed, with downloading and installation explicitly disabled.
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
const packagedDir=process.env.MAGIDEPTH_PACKAGED_DIR?path.resolve(process.env.MAGIDEPTH_PACKAGED_DIR):null;
const testPublishedFeed=process.env.MAGIDEPTH_TEST_UPDATE_FEED==='1';
if(testPublishedFeed&&!packagedDir){console.error('MAGIDEPTH_TEST_UPDATE_FEED requires MAGIDEPTH_PACKAGED_DIR.');process.exit(1);}

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
  const appRoot=packagedDir?path.join(packagedDir,'resources','app.asar'):root;
  const resourceRoot=packagedDir?path.join(packagedDir,'resources'):null;
  let packageVersion;
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
    // The test Electron host supplies application metadata normally supplied by
    // its packaged bootstrap. All main/preload/IPC/backend code remains unchanged.
    app.getAppPath=()=>appRoot;
    assert.equal(app.getAppPath(),appRoot);
    if(packagedDir){
      const metadata=JSON.parse(fsSync.readFileSync(path.join(appRoot,'package.json'),'utf8'));
      assert.ok(fsSync.existsSync(path.join(packagedDir,`${metadata.build?.productName||'MagiMagic'}.exe`)),'Packaged application executable is missing');
      const expected=JSON.parse(fsSync.readFileSync(path.join(root,'package.json'),'utf8'));
      assert.equal(metadata.name,'magidepth');assert.equal(metadata.version,expected.version);packageVersion=metadata.version;
      Object.defineProperty(app,'isPackaged',{value:true,configurable:true});
      Object.defineProperty(process,'resourcesPath',{value:resourceRoot,configurable:true});
      app.getVersion=()=>metadata.version;
      app.setPath('userData',data);
      // Production pins the legacy MagiDepth cache location after the rename.
      // Redirect that call only inside this application-owned hidden test host.
      const setPath=app.setPath.bind(app);
      app.setPath=(name,value)=>setPath(name,name==='userData'?data:value);
      // Network update checks are explicitly disabled for this offline harness.
      const initialPrefs=prefsExisted?JSON.parse(originalPrefs.toString('utf8')):{};
      fsSync.writeFileSync(prefsPath,JSON.stringify({...initialPrefs,autoUpdate:false,tutorialDone:true}));
    }
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
    require(path.join(appRoot,'app-desktop','main.cjs'));
    await loaded;
    if(failure)throw failure;
    if(packagedDir)await check('packaged ASAR, version, backend, runtime assets and license resources',async()=>{
      assert.equal(app.isPackaged,true);assert.equal(app.getVersion(),packageVersion);assert.equal(app.getPath('userData'),data);
      for(const relative of ['backend/daemon.py','backend/cloak_daemon.py','backend/engine.py','backend/exporter.py','backend/requirements.txt','runtime-assets/manifest.json','runtime-assets/python-embed.zip','runtime-assets/pip.whl','licenses/MagiDepth-LICENSE.txt','licenses/THIRD_PARTY_NOTICES.md','app-update.yml'])assert.ok((await fs.stat(path.join(resourceRoot,relative))).size>0,`Missing packaged resource ${relative}`);
      for(const relative of ['app-desktop/main.cjs','app-desktop/preload.cjs','dist/index.html','dist/brand/magidepth.png'])assert.ok((await fs.stat(path.join(appRoot,relative))).size>0,`Missing ASAR asset ${relative}`);
      const updater=await fs.readFile(path.join(resourceRoot,'app-update.yml'),'utf8');assert.match(updater,/provider:\s*github/);assert.match(updater,/repo:\s*magidepth/);
      console.log(`INFO Packaged MagiMagic v${packageVersion}; loading real ASAR and external resource paths.`);
    });
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
      assert.equal(runtime.cloakReady,true);assert.ok(runtime.mediaTools?.ffmpeg);assert.ok(runtime.mediaTools?.version);
      const system=await api('getSystem');assert.equal(system.ffmpeg,true);assert.ok(system.python);assert.ok(system.torch);
      assert.equal(typeof system.cuda,'boolean');
      if(packagedDir)assert.equal(system.appVersion,packageVersion);
      console.log(`INFO Electron ${process.versions.electron}; Python ${system.python}; PyTorch ${system.torch}; CUDA available ${system.cuda}`);
    });
    const ffmpeg=(await api('getRuntime')).mediaTools.ffmpeg;
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
    await check('MagiCloak batch selection, separate preferences and live frame IPC',async()=>{
      openResponses.push({canceled:false,filePaths:[png,mp4]});assert.deepEqual(await api('chooseCloakFiles'),[png,mp4]);
      openResponses.push({canceled:false,filePaths:[outputDir]});assert.equal(await api('chooseCloakOutputDir'),outputDir);
      const suggested=path.join(outputDir,'cloak-save.webp');saveResponses.push({canceled:false,filePath:suggested});assert.equal(await api('chooseCloakSavePath',suggested),suggested);
      const preferences=await api('getPreferences');assert.equal(preferences.cloakOutputDir,outputDir);
      const manual={...preferences.cloakOptions,methods:{A:false,B:false,C:false},tracking:false,use_grid:true};
      const saved=await api('setPreferences',{cloakOptions:{...manual,grid:{...manual.grid,rows:9}}});
      assert.equal(saved.cloakOptions.grid.rows,9);assert.deepEqual(saved.options.maps,['source']);
      for(const source of [png,mp4]){
        const info=await api('cloakProbe',source);assert.ok(info.frames>0);assert.match(info.thumbnail,/^data:image\/png;base64,/);
        const preview=await api('cloakPreview',{jobId:`cloak-preview-${crypto.randomUUID()}`,path:source,time:0,options:manual});
        assert.match(preview.image,/^data:image\/png;base64,/);assert.notEqual(preview.image,preview.source);assert.equal(preview.faceCount,0);
      }
    });
    await check('MagiCloak mixed batch export, padding, progress and source preservation',async()=>{
      const preferences=await api('getPreferences');
      const manual={...preferences.cloakOptions,methods:{A:false,B:false,C:false},tracking:false,use_grid:true,pad_enabled:true,pad_seconds:3,quality:'balanced'};
      const outputs=[path.join(outputDir,'cloak-image.png'),path.join(outputDir,'cloak-padded.mp4')];
      await renderer(()=>{window.__testCloakProgress=[];window.__testCloakOff=window.depthdesk.onCloakProgress(event=>window.__testCloakProgress.push(event));});
      const result=await api('cloakRender',{jobId:`cloak-render-${crypto.randomUUID()}`,jobs:[{path:png,outputPath:outputs[0]},{path:mp4,outputPath:outputs[1]}],options:manual});
      assert.deepEqual(result.outputs,outputs);assert.equal(result.frames,37);
      const exported=await api('cloakProbe',outputs[1]);assert.equal(exported.frames,36);assert.equal(exported.fps,12);
      const events=await renderer(()=>{window.__testCloakOff();return window.__testCloakProgress;});
      assert.equal(events.filter(event=>event.stage==='file-complete').length,2);assert.ok(events.some(event=>event.preview));
      assert.ok(events.every(event=>event.progress>=0&&event.progress<=1));
      assert.equal((await net.fetch(`depthdesk-media://local/?path=${encodeURIComponent(outputs[0])}`)).status,200);
      assert.equal(crypto.createHash('sha256').update(await fs.readFile(png)).digest('hex'),originalHash);
      await assert.rejects(()=>api('cloakRender',{jobId:`cloak-render-${crypto.randomUUID()}`,jobs:[{path:png,outputPath:png}],options:manual}),/덮어쓸/);
      await assert.rejects(()=>api('cloakRender',{jobId:`cloak-render-${crypto.randomUUID()}`,jobs:[{path:png,outputPath:outputs[0]}],options:manual}),/이미/);
      const destination=path.join(outputDir,'cloak-cancelled.mp4'),jobId=`cloak-render-${crypto.randomUUID()}`;
      await renderer(request=>{window.__testCloakCancel=window.depthdesk.cloakRender(request).then(()=>({ok:true}),error=>({ok:false,error:String(error)}));return true;},{jobId,jobs:[{path:mp4,outputPath:destination}],options:manual});
      await api('cancelCloakJob',jobId);const cancelled=await renderer(()=>window.__testCloakCancel);assert.equal(cancelled.ok,false);assert.match(cancelled.error,/cancel|취소/i);
      await assert.rejects(()=>fs.stat(destination),error=>error.code==='ENOENT');
    });
    await check('MagiCloak before padding and MOV MKV M4V through actual IPC',async()=>{
      const preferences=await api('getPreferences');
      const options={...preferences.cloakOptions,methods:{A:false,B:false,C:false},tracking:false,use_grid:false,pad_enabled:true,pad_seconds:3,pad_position:'before',quality:'balanced'};
      const saved=await api('setPreferences',{cloakOptions:options});assert.equal(saved.cloakOptions.pad_position,'before');
      for(const extension of ['mov','mkv','m4v']){
        const destination=path.join(outputDir,`cloak-before.${extension}`);
        saveResponses.push({canceled:false,filePath:destination});assert.equal(await api('chooseCloakSavePath',destination),destination);
        const result=await api('cloakRender',{jobId:`cloak-prefix-${crypto.randomUUID()}`,jobs:[{path:mp4,outputPath:destination}],options});assert.equal(result.frames,36);
        const info=await api('cloakProbe',destination);assert.equal(info.frames,36);
        const first=spawnSync(ffmpeg,['-v','error','-i',destination,'-frames:v','1','-pix_fmt','gray','-f','rawvideo','-'],{windowsHide:true});
        assert.equal(first.status,0);assert.equal(first.stdout.length,320*180);assert.ok(first.stdout.every(value=>value<3),'First frame must be black, not the original');
      }
    });
    if(!packagedDir)await check('development update event through preload subscription',async()=>{
      await renderer(()=>{window.__testUpdate=null;window.__testUnsubscribe=window.depthdesk.onUpdate(value=>{window.__testUpdate=value;});});
      await api('checkForUpdates');const update=await renderer(()=>{window.__testUnsubscribe();return window.__testUpdate;});assert.equal(update.status,'up-to-date');
    });
    else if(testPublishedFeed)await check('published update feed matches installed version without downloading',async()=>{
      // Resolve the same updater instance used by this packaged main module.
      const {createRequire}=require('node:module');
      const packagedRequire=createRequire(path.join(appRoot,'app-desktop','main.cjs'));
      const {autoUpdater}=packagedRequire('electron-updater');
      autoUpdater.autoDownload=false;
      autoUpdater.autoInstallOnAppQuit=false;
      autoUpdater.allowPrerelease=false;
      autoUpdater.allowDowngrade=false;
      assert.equal(autoUpdater.autoDownload,false);
      assert.equal(autoUpdater.autoInstallOnAppQuit,false);
      await renderer(()=>{
        window.__testPublishedFeed=new Promise(resolve=>{
          window.__testFeedUnsubscribe=window.depthdesk.onUpdate(value=>{
            if(['up-to-date','available','ready','error'].includes(value.status))resolve(value);
          });
        });
      });
      let timer;
      try{
        const terminal=await Promise.race([
          Promise.all([api('checkForUpdates'),renderer(()=>window.__testPublishedFeed)]).then(([,status])=>status),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Published update feed did not return within 45 seconds.')),45000);}),
        ]);
        // A newer release is a test failure, not permission to download it.
        assert.equal(terminal.status,'up-to-date',`Expected current published version; received ${terminal.status}${terminal.version?` v${terminal.version}`:''}${terminal.message?`: ${terminal.message}`:''}`);
        assert.equal(terminal.version,packageVersion,'Published feed version must match the tested package.');
        assert.equal(autoUpdater.autoDownload,false);
        assert.equal(autoUpdater.autoInstallOnAppQuit,false);
        console.log(`INFO Published feed reports MagiDepth v${terminal.version} up to date; no update download or installation requested.`);
      }finally{clearTimeout(timer);await renderer(()=>{window.__testFeedUnsubscribe?.();});}
    });
    else console.log('SKIP packaged network update check (offline integration; no installation/update is triggered).');
    console.log(`PASS ALL ${tests.length} ${packagedDir?'packaged-resource ':''}Electron integration checks. No AI models loaded; all fixture media is synthetic.`);
    await fs.writeFile(path.join(fixtureDir,'integration-report.json'),JSON.stringify({ok:true,mode:packagedDir?'packaged-resources':'development',publishedFeedChecked:testPublishedFeed,version:packageVersion,electron:process.versions.electron,tests},null,2));
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
