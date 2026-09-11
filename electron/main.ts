import {app,BrowserWindow,clipboard,dialog,ipcMain,net,protocol,session,shell} from 'electron';
import {autoUpdater} from 'electron-updater';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {RuntimeManager} from './runtime';
import {PythonWorker} from './worker';
import {requireLocalPath,safeAssetPath,sanitizeOptions,sanitizeCloakOptions,sanitizePreferences} from './policy';
import type {Preferences,UpdateStatus} from '../shared/contracts';

protocol.registerSchemesAsPrivileged([
  {scheme:'depthdesk',privileges:{standard:true,secure:true,supportFetchAPI:true}},
  {scheme:'depthdesk-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}},
]);
// Keep the installed identity and cache location across the MagiMagic rename.
app.setPath('userData',path.join(app.getPath('appData'),'MagiDepth'));
app.setName('MagiMagic');
let window:BrowserWindow;
let runtime:RuntimeManager;
let worker:PythonWorker|undefined;
let cloakWorker:PythonWorker|undefined;
let workerFingerprint='';
let cloakWorkerFingerprint='';
let runtimePreparing=false;
let prefs:Preferences;
let allowExit=false;
const activeJobs=new Set<string>();
const cancelledJobs=new Set<string>();
const allowedMedia=new Set<string>();
const packaged=app.isPackaged;
const root=app.getAppPath();
const assets=packaged?path.join(process.resourcesPath,'runtime-assets'):path.join(root,'resources');
const backend=packaged?path.join(process.resourcesPath,'backend'):path.join(root,'backend');
const devUrl=!packaged?process.env.DEPTHDESK_DEV_URL:undefined;
if(process.env.DEPTHDESK_TEST_USER_DATA&&!packaged)app.setPath('userData',process.env.DEPTHDESK_TEST_USER_DATA);
const prefsPath=path.join(app.getPath('userData'),'preferences.json');
let prefsWrite:Promise<void>=Promise.resolve();
const send=(channel:string,data:any)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,data);};
async function savePrefs(update:any){
  prefs=sanitizePreferences({...prefs,...update,options:{...prefs.options,...update?.options},cloakOptions:{...prefs.cloakOptions,...update?.cloakOptions,methods:{...prefs.cloakOptions.methods,...update?.cloakOptions?.methods},grid:{...prefs.cloakOptions.grid,...update?.cloakOptions?.grid}}});
  const snapshot=JSON.stringify(prefs,null,2);
  prefsWrite=prefsWrite.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(prefsPath),{recursive:true});const temp=prefsPath+'.tmp';await fs.writeFile(temp,snapshot);await fs.rename(temp,prefsPath);});
  await prefsWrite;
  return prefs;
}
async function engine(scope:'depth'|'cloak'='depth'){
  if(runtimePreparing||runtime.status.installing)throw new Error('엔진을 준비 중입니다. 준비가 끝난 뒤 다시 시도해 주세요.');
  const state=await runtime.inspect();
  // An install may have begun while inspection was awaiting Python/media checks.
  if(runtimePreparing||runtime.status.installing)throw new Error('엔진을 준비 중입니다. 준비가 끝난 뒤 다시 시도해 주세요.');
  if(!(scope==='cloak'?state.cloakReady:state.ready))throw new Error(scope==='cloak'?'먼저 MagiCloak 엔진 준비를 완료해 주세요.':'먼저 MagiDepth AI 엔진 설치를 완료해 주세요.');
  const config={python:runtime.pythonPath,backend,bin:runtime.binDir,ffmpeg:runtime.mediaTools?.ffmpeg,ffprobe:runtime.mediaTools?.ffprobe,models:runtime.modelsDir,logs:path.join(app.getPath('userData'),'logs')};
  const fingerprint=JSON.stringify([config.python,config.backend,config.ffmpeg,config.ffprobe,config.models,scope]);
  if(scope==='cloak'){
    if(cloakWorker&&cloakWorkerFingerprint!==fingerprint){
      if(cloakWorker.busy)throw new Error('영상 도구 경로가 변경되었습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
      const previous=cloakWorker;await previous.stop();if(cloakWorker===previous){cloakWorker=undefined;cloakWorkerFingerprint='';}
      return engine(scope);
    }
    if(runtimePreparing||runtime.status.installing)throw new Error('엔진을 준비 중입니다. 준비가 끝난 뒤 다시 시도해 주세요.');
    cloakWorker??=new PythonWorker({...config,daemonEntry:'cloak_daemon.py'},event=>{
      const output=(event as any).outputPath;
      if(typeof output==='string')allowedMedia.add(path.resolve(output).toLowerCase());
      send('cloak:progress',event);
    });
    cloakWorkerFingerprint=fingerprint;
    return cloakWorker;
  }
  if(worker&&workerFingerprint!==fingerprint){
    if(worker.busy)throw new Error('영상 도구 경로가 변경되었습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
    const previous=worker;await previous.stop();if(worker===previous){worker=undefined;workerFingerprint='';}
    return engine(scope);
  }
  if(runtimePreparing||runtime.status.installing)throw new Error('엔진을 준비 중입니다. 준비가 끝난 뒤 다시 시도해 주세요.');
  worker??=new PythonWorker(config,event=>send('depth:progress',event));
  workerFingerprint=fingerprint;
  return worker;
}
async function stopWorkers(){
  const previous=worker,previousCloak=cloakWorker;
  // Both modules share one Python installation. Neither may retain DLL locks.
  await Promise.all([previous?.stop(),previousCloak?.stop()]);
  if(worker===previous){worker=undefined;workerFingerprint='';}
  if(cloakWorker===previousCloak){cloakWorker=undefined;cloakWorkerFingerprint='';}
}
async function installRuntime(scope:unknown){
  if(activeJobs.size)throw new Error('작업이 끝난 뒤 엔진을 준비해 주세요.');
  if(runtimePreparing||runtime.status.installing)throw new Error('이미 엔진을 준비 중입니다. 잠시 기다려 주세요.');
  runtimePreparing=true;
  try{
    await stopWorkers();
    // A pending file validation may have registered a job while workers stopped.
    if(activeJobs.size)throw new Error('작업이 끝난 뒤 엔진을 준비해 주세요.');
    return await(scope==='cloak'?runtime.installCloak():runtime.install());
  }finally{runtimePreparing=false;}
}
function handle(channel:string,fn:(...args:any[])=>unknown){
  ipcMain.handle(channel,(event,...args)=>{
    const url=event.senderFrame?.url||'';
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!(url.startsWith('depthdesk://app/')||(devUrl&&new URL(url).origin===new URL(devUrl).origin)))throw new Error('Unauthorized IPC');
    return fn(...args);
  });
}
async function sourcePath(value:unknown){
  const file=requireLocalPath(value);
  if(!/\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|mts|mxf|png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(file))throw new Error('지원되는 이미지 또는 영상 파일을 선택해 주세요.');
  const real=await fs.realpath(file);if(!(await fs.stat(real)).isFile())throw new Error('영상 파일이 아닙니다.');allowedMedia.add(real.toLowerCase());return real;
}
function setupIPC(){
  handle('prefs:get',()=>prefs);handle('prefs:set',savePrefs);
  handle('video:choose',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Images & videos',extensions:['mp4','mov','mkv','avi','webm','m4v','mts','mxf','png','jpg','jpeg','webp','bmp','tif','tiff']}]});return result.canceled?null:sourcePath(result.filePaths[0]);});
  handle('cloak:choose',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],filters:[{name:'Images & videos',extensions:['mp4','mov','mkv','avi','webm','m4v','wmv','flv','png','jpg','jpeg','webp','bmp','tif','tiff']}]});return result.canceled?[]:Promise.all(result.filePaths.map(sourcePath));});
  handle('cloak:probe',async p=>{const file=await sourcePath(p);return(await engine('cloak')).request(crypto.randomUUID(),'probe',{path:file});});
  for(const command of ['preview','render'])handle(`cloak:${command}`,async request=>{
    if(!request||typeof request.jobId!=='string'||!request.jobId.length||request.jobId.length>100)throw new Error('Invalid job');
    if(runtimePreparing||runtime.status.installing)throw new Error('엔진을 준비 중입니다. 준비가 끝난 뒤 다시 시도해 주세요.');
    if(activeJobs.size)throw new Error('다른 마법이 작업 중입니다. 완료하거나 취소한 뒤 다시 시도해 주세요.');
    activeJobs.add(request.jobId);
    try{
      const options=sanitizeCloakOptions(request.options);
      let payload:any;
      if(command==='preview')payload={path:await sourcePath(request.path),time:Number.isFinite(request.time)?Math.max(0,request.time):0,findFace:request.findFace===true,options};
      else{
        if(!Array.isArray(request.jobs)||!request.jobs.length||request.jobs.length>500)throw new Error('처리할 파일을 1~500개 선택해 주세요.');
        const inputs=await Promise.all(request.jobs.map((job:any)=>sourcePath(job?.path)));
        const seen=new Set<string>();const jobs=[];
        for(let i=0;i<inputs.length;i++){
          const output=requireLocalPath(request.jobs[i].outputPath);
          const image=/\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(inputs[i]);
          if(!(image?/\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/i:/\.(mp4|mov|mkv|m4v)$/i).test(output))throw new Error(image?'지원되는 이미지 출력 확장자를 선택해 주세요.':'영상 출력은 .mp4, .mov, .mkv 또는 .m4v를 선택해 주세요.');
          await fs.mkdir(path.dirname(output),{recursive:true});
          const parent=await fs.realpath(path.dirname(output));
          const canonical=path.join(parent,path.basename(output));const key=canonical.toLowerCase();
          if(inputs.some(input=>input.toLowerCase()===key))throw new Error('원본 파일을 덮어쓸 수 없습니다.');
          if(seen.has(key))throw new Error('배치 출력 파일명이 겹칩니다. 서로 다른 이름을 선택해 주세요.');
          seen.add(key);
          try{await fs.access(canonical);throw new Error('같은 이름의 파일이 이미 있습니다. 다른 이름을 선택해 주세요.');}catch(err:any){if(err.code!=='ENOENT')throw err;}
          jobs.push({path:inputs[i],outputPath:canonical});
        }
        payload={jobs,options};
      }
      const process=await engine('cloak');if(cancelledJobs.has(request.jobId))throw new Error('작업이 취소되었습니다.');
      const result=await process.request<any>(request.jobId,command,payload);
      for(const file of result?.outputs||[])allowedMedia.add(path.resolve(file).toLowerCase());
      return result;
    }finally{activeJobs.delete(request.jobId);cancelledJobs.delete(request.jobId);}
  });
  handle('cloak:cancel',async id=>{if(typeof id!=='string')throw new Error('Invalid job');if(activeJobs.has(id))cancelledJobs.add(id);if(cloakWorker)await cloakWorker.request(crypto.randomUUID(),'cancel',{jobId:id});});
  handle('cloak:choose-dir',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],defaultPath:prefs.cloakOutputDir||prefs.outputDir||app.getPath('videos')});if(result.canceled)return null;await savePrefs({cloakOutputDir:result.filePaths[0]});return result.filePaths[0];});
  handle('cloak:save-as',async suggested=>{
    const proposed=typeof suggested==='string'?suggested:'scene_cloaked.mp4';
    const image=/\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(proposed);
    const result=await dialog.showSaveDialog(window,{defaultPath:path.isAbsolute(proposed)?proposed:path.join(prefs.cloakOutputDir||prefs.outputDir||app.getPath('videos'),path.basename(proposed)),filters:image?[{name:'PNG · alpha preserved',extensions:['png']},{name:'JPEG',extensions:['jpg','jpeg']},{name:'WebP',extensions:['webp']},{name:'BMP / TIFF',extensions:['bmp','tif','tiff']}]:[{name:'MP4 video',extensions:['mp4']},{name:'QuickTime MOV',extensions:['mov']},{name:'Matroska MKV',extensions:['mkv']},{name:'M4V video',extensions:['m4v']}],properties:['createDirectory','showOverwriteConfirmation']});
    if(result.canceled||!result.filePath)return null;await savePrefs({cloakOutputDir:path.dirname(result.filePath)});return result.filePath;
  });
  handle('image:paste',async()=>{
    const items=await clipboard.read();
    for(const item of items){
      if(!item.types.includes('image/png'))continue;
      const blob=await item.getType('image/png');
      if(!('arrayBuffer' in blob))continue;
      const bytes=Buffer.from(await blob.arrayBuffer());
      if(!bytes.length)continue;
      const folder=path.join(app.getPath('userData'),'clipboard');await fs.mkdir(folder,{recursive:true});
      const file=path.join(folder,`Clipboard-${Date.now()}-${crypto.randomUUID().slice(0,8)}.png`);
      await fs.writeFile(file,bytes);allowedMedia.add(file.toLowerCase());return file;
    }
    return null;
  });
  handle('video:probe',async p=>{const file=await sourcePath(p);return(await engine()).request(crypto.randomUUID(),'probe',{path:file});});
  for(const command of ['preview','render'])handle(`depth:${command}`,async request=>{
    if(!request||typeof request.jobId!=='string'||request.jobId.length>100)throw new Error('Invalid job');
    if(runtimePreparing||runtime.status.installing)throw new Error('엔진을 준비 중입니다. 준비가 끝난 뒤 다시 시도해 주세요.');
    if(activeJobs.size)throw new Error('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
    activeJobs.add(request.jobId);
    try{
    const file=await sourcePath(request.path);const payload={...request,path:file,options:sanitizeOptions(request.options)};
    if(command==='render'){
      const output=requireLocalPath(request.outputPath);
      const isImage=/\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(file);
      if(path.extname(output).toLowerCase()!==(isImage?'.png':'.mp4'))throw new Error(isImage?'이미지 출력 확장자는 .png여야 합니다.':'영상 출력 확장자는 .mp4여야 합니다.');
      if(output.toLowerCase()===file.toLowerCase())throw new Error('원본 파일을 덮어쓸 수 없습니다.');
      try{await fs.access(output);throw new Error('같은 이름의 파일이 이미 있습니다. 다른 이름을 선택해 주세요.');}catch(err:any){if(err.code!=='ENOENT')throw err;}
      payload.outputPath=output;
    }
    const process=await engine();if(cancelledJobs.has(request.jobId))throw new Error('작업이 취소되었습니다.');
    const result=await process.request<any>(request.jobId,command,payload);
    for(const file of Object.values(result?.outputPaths||{}) as string[])allowedMedia.add(path.resolve(file).toLowerCase());
    if(result?.outputPath)allowedMedia.add(path.resolve(result.outputPath).toLowerCase());return result;
    }finally{activeJobs.delete(request.jobId);cancelledJobs.delete(request.jobId);}
  });
  handle('depth:cancel',async id=>{if(typeof id!=='string')throw new Error('Invalid job');if(activeJobs.has(id))cancelledJobs.add(id);if(worker)await worker.request(crypto.randomUUID(),'cancel',{jobId:id});});
  handle('output:choose-dir',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],defaultPath:prefs.outputDir||app.getPath('videos')});if(result.canceled)return null;await savePrefs({outputDir:result.filePaths[0]});return result.filePaths[0];});
  handle('output:save-as',async suggested=>{const proposed=typeof suggested==='string'?suggested:'depth-video.mp4';const defaultPath=path.isAbsolute(proposed)?proposed:path.join(prefs.outputDir||app.getPath('videos'),path.basename(proposed));const isImage=/\.png$/i.test(proposed);const result=await dialog.showSaveDialog(window,{defaultPath,filters:[{name:isImage?'PNG map image':'MP4 map video',extensions:[isImage?'png':'mp4']}],properties:['createDirectory','showOverwriteConfirmation']});if(result.canceled||!result.filePath)return null;await savePrefs({outputDir:path.dirname(result.filePath)});return result.filePath;});
  handle('output:open-folder',async p=>{const folder=requireLocalPath(p||prefs.outputDir||app.getPath('videos'));if(!(await fs.stat(folder)).isDirectory())throw new Error('폴더가 아닙니다.');const error=await shell.openPath(folder);if(error)throw new Error(error);});
  handle('output:reveal',async p=>{const file=requireLocalPath(p);await fs.access(file);shell.showItemInFolder(file);});
  handle('runtime:get',()=>runtime.inspect());handle('runtime:install',installRuntime);
  handle('system:get',async()=>{
    const state=await runtime.inspect();
    if(!state.ready)return {cuda:false,gpu:'MagiCloak · CPU',vramGB:0,freeVramGB:0,torch:'MagiDepth 엔진 준비 전',python:state.cloakReady?'3.13':'미설치',ffmpeg:!!state.mediaTools,mediaTools:state.mediaTools,appVersion:app.getVersion()};
    return {...await(await engine()).request<any>(crypto.randomUUID(),'system',{}),mediaTools:state.mediaTools,appVersion:app.getVersion()};
  });
  handle('update:check',()=>checkUpdates());
  handle('update:install',()=>{if(activeJobs.size||runtime.status.installing)throw new Error('작업이 끝난 뒤 업데이트해 주세요.');allowExit=true;autoUpdater.quitAndInstall(false,true);});
}
const update=(status:UpdateStatus)=>send('update:progress',status);
async function checkUpdates(){
  if(!packaged){update({status:'up-to-date',message:'개발 빌드에서는 업데이트를 설치하지 않습니다.'});return;}
  try{await autoUpdater.checkForUpdates();}catch(err){update({status:'error',message:err instanceof Error?err.message:String(err)});}
}
function setupUpdates(){
  autoUpdater.autoDownload=true;autoUpdater.autoInstallOnAppQuit=false;
  autoUpdater.on('checking-for-update',()=>update({status:'checking'}));
  autoUpdater.on('update-available',info=>update({status:'available',version:info.version}));
  autoUpdater.on('update-not-available',info=>update({status:'up-to-date',version:info.version}));
  autoUpdater.on('download-progress',info=>update({status:'downloading',percent:info.percent}));
  autoUpdater.on('update-downloaded',info=>update({status:'ready',version:info.version}));
  autoUpdater.on('error',err=>update({status:'error',message:err.message}));
  if(prefs.autoUpdate)setTimeout(()=>void checkUpdates(),15000);
}
async function createWindow(){
  try{prefs=sanitizePreferences(JSON.parse(await fs.readFile(prefsPath,'utf8')));}catch{prefs=sanitizePreferences({});}
  runtime=new RuntimeManager(app.getPath('userData'),assets,backend,state=>send('runtime:progress',state),!packaged?process.env.DEPTHDESK_PYTHON:undefined);
  protocol.handle('depthdesk',async request=>{
    try{const url=new URL(request.url);if(url.host!=='app')return new Response('Forbidden',{status:403});const file=safeAssetPath(path.join(root,'dist'),url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname));return net.fetch(pathToFileURL(file).toString());}catch{return new Response('Not found',{status:404});}
  });
  protocol.handle('depthdesk-media',async request=>{
    try{const url=new URL(request.url);if(url.host!=='local')return new Response('Forbidden',{status:403});const file=await fs.realpath(requireLocalPath(url.searchParams.get('path')));if(!allowedMedia.has(file.toLowerCase()))return new Response('Forbidden',{status:403});return net.fetch(pathToFileURL(file).toString(),{headers:request.headers});}catch{return new Response('Not found',{status:404});}
  });
  window=new BrowserWindow({width:1440,height:960,minWidth:1040,minHeight:720,backgroundColor:'#101113',title:'MagiMagic · 매지매직',autoHideMenuBar:true,show:false,icon:path.join(root,'dist','brand','magidepth.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!=='depthdesk://app/index.html'&&!(devUrl&&new URL(url).origin===new URL(devUrl).origin))event.preventDefault();});
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[devUrl?"default-src 'self' data: blob: depthdesk-media:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data: blob: depthdesk-media:; media-src 'self' blob: depthdesk-media:":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: depthdesk-media:; media-src 'self' blob: depthdesk-media:; connect-src 'self' depthdesk-media:; object-src 'none'; base-uri 'self'; frame-src 'none'"]}}));
  setupIPC();setupUpdates();
  window.once('ready-to-show',()=>window.show());
  window.on('close',event=>{if(!allowExit&&(activeJobs.size||runtime.status.installing)){const answer=dialog.showMessageBoxSync(window,{type:'question',buttons:['계속 작업','종료'],defaultId:0,cancelId:0,message:'진행 중인 작업이 있습니다. 종료할까요?',detail:'완료되지 않은 렌더는 저장되지 않습니다.'});if(answer===0)event.preventDefault();}});
  await window.loadURL(devUrl||'depthdesk://app/index.html');
}
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(createWindow).catch(err=>{dialog.showErrorBox('MagiMagic 시작 실패',String(err));app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{void stopWorkers().catch(()=>{});runtime?.stop();});
}
