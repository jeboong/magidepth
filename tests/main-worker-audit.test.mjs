import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),temp=await fs.mkdtemp(path.join(os.tmpdir(),'magimagic-main-audit-'));
after(async()=>{await fs.rm(temp,{recursive:true,force:true});});
const mainSource=await fs.readFile('electron/main.ts','utf8');
// Export test hooks only in this in-memory bundle, never in the packaged app.
const mainBundle=await build({stdin:{contents:mainSource+'\nexport const __audit={engine,installRuntime,stopWorkers,activeJobs,setupIPC,init(rt,w){runtime=rt;window=w;prefs=sanitizePreferences({});}};',resolveDir:path.resolve('electron'),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['electron','electron-updater','./runtime','./worker']});
const workerBundle=await build({entryPoints:['electron/worker.ts'],bundle:true,platform:'node',format:'cjs',write:false});
function executeBundle(code,overrides,directory=temp){
  const module={exports:{}};
  new Function('require','module','exports','__dirname','process',code)(name=>overrides[name]??require(name),module,module.exports,directory,{...process,env:{...process.env,DEPTHDESK_TEST_USER_DATA:undefined,DEPTHDESK_DEV_URL:undefined}});
  return module.exports;
}
let serial=0;
async function fixture(){
  const dir=path.join(temp,`case-${serial++}`);await fs.mkdir(dir,{recursive:true});
  const handlers=new Map(),created=[],events=[],dialogs=[];
  const paths={appData:dir,userData:path.join(dir,'MagiDepth'),videos:dir};
  const electron={
    app:{getPath:key=>paths[key],setPath:(key,value)=>{paths[key]=value;},setName:()=>{},getAppPath:()=>path.resolve('.'),isPackaged:false,requestSingleInstanceLock:()=>false,quit:()=>{}},
    protocol:{registerSchemesAsPrivileged:()=>{}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    dialog:{showSaveDialog:async(_window,options)=>{dialogs.push(options);return {canceled:false,filePath:path.join(dir,path.basename(options.defaultPath))};}},
  };
  class FakeWorker{
    busy=false; stopped=false;
    constructor(config){this.config=config;this.id=created.length;created.push(this);}
    async stop(){events.push(`stop:${this.id}`);if(this.stopGate)await this.stopGate;this.stopped=true;events.push(`closed:${this.id}`);}
    async request(id,command,payload){events.push(`request:${this.id}:${command}`);return command==='render'?{outputs:payload.jobs?.map(job=>job.outputPath)||[]}:{};}
  }
  const {__audit}=executeBundle(mainBundle.outputFiles[0].text,{electron,'electron-updater':{autoUpdater:{}},'./runtime':{RuntimeManager:class{}},'./worker':{PythonWorker:FakeWorker}},dir);
  const state={ready:true,cloakReady:true,installing:false},runtime={status:state,pythonPath:path.join(dir,'python.exe'),binDir:path.join(dir,'private-tools'),modelsDir:path.join(dir,'models'),mediaTools:{ffmpeg:path.join(dir,'Tool One','ffmpeg.exe'),ffprobe:path.join(dir,'Tool Two','ffprobe.exe')},inspect:async()=>state,install:async()=>{events.push('install:depth');return state;},installCloak:async()=>{events.push('install:cloak');return state;}};
  const window={webContents:{mainFrame:{url:'depthdesk://app/index.html'}}};
  __audit.init(runtime,window);__audit.setupIPC();
  const call=(name,...args)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);
  return {audit:__audit,dir,runtime,state,events,created,dialogs,call};
}
test('unchanged launch fingerprint preserves each idle worker; changed tools recreate only affected launch',async()=>{
  const f=await fixture();const first=await f.audit.engine(),cloak=await f.audit.engine('cloak');
  assert.equal(await f.audit.engine(),first);assert.equal(await f.audit.engine('cloak'),cloak);assert.equal(f.created.length,2);
  f.runtime.mediaTools={...f.runtime.mediaTools,ffmpeg:path.join(f.dir,'New Tools','ffmpeg.exe')};
  const next=await f.audit.engine();assert.notEqual(next,first);assert.equal(first.stopped,true);assert.equal(cloak.stopped,false);assert.equal(next.config.ffmpeg,f.runtime.mediaTools.ffmpeg);
  const nextCloak=await f.audit.engine('cloak');assert.notEqual(nextCloak,cloak);assert.equal(cloak.stopped,true);assert.equal(nextCloak.config.daemonEntry,'cloak_daemon.py');
});
test('changed paths do not stop a worker with a pending request',async()=>{
  const f=await fixture(),worker=await f.audit.engine('cloak');worker.busy=true;f.runtime.mediaTools.ffprobe=path.join(f.dir,'updated-probe.exe');
  await assert.rejects(f.audit.engine('cloak'),/진행 중/);assert.equal(worker.stopped,false);
});
test('runtime installation waits for both processes to close and blocks new launch/jobs',async()=>{
  const f=await fixture(),depth=await f.audit.engine(),cloak=await f.audit.engine('cloak');let releaseDepth,releaseCloak;
  depth.stopGate=new Promise(resolve=>{releaseDepth=resolve;});cloak.stopGate=new Promise(resolve=>{releaseCloak=resolve;});
  const installation=f.audit.installRuntime('cloak');await Promise.resolve();assert.ok(f.events.includes('stop:0'));assert.ok(f.events.includes('stop:1'));assert.equal(f.events.includes('install:cloak'),false);
  await assert.rejects(f.audit.engine('cloak'),/준비 중/);
  await assert.rejects(f.call('cloak:preview',{jobId:'cloak-preview-test'}),/준비 중/);
  await assert.rejects(f.call('depth:preview',{jobId:'preview-test'}),/준비 중/);
  releaseDepth();await Promise.resolve();assert.equal(f.events.includes('install:cloak'),false);releaseCloak();await installation;
  assert.ok(f.events.indexOf('install:cloak')>f.events.indexOf('closed:0'));assert.ok(f.events.indexOf('install:cloak')>f.events.indexOf('closed:1'));
  assert.notEqual(await f.audit.engine(),depth);assert.notEqual(await f.audit.engine('cloak'),cloak);
});
test('active render prevents repair before either worker is stopped',async()=>{
  const f=await fixture();await f.audit.engine();f.audit.activeJobs.add('render-in-flight');await assert.rejects(f.audit.installRuntime('depth'),/작업이 끝난/);assert.equal(f.events.length,0);
});
test('engine rechecks installation guard after asynchronous inspection',async()=>{
  const f=await fixture();let inspected;
  f.runtime.inspect=()=>new Promise(resolve=>{inspected=resolve;});const pending=f.audit.engine();
  f.state.installing=true;inspected(f.state);await assert.rejects(pending,/준비 중/);assert.equal(f.created.length,0);
});
test('failed process shutdown aborts installation rather than risking locked DLLs',async()=>{
  const f=await fixture(),worker=await f.audit.engine();worker.stop=async()=>{throw Error('still running');};
  await assert.rejects(f.audit.installRuntime('depth'),/still running/);assert.equal(f.events.includes('install:depth'),false);
});
test('Cloak save-as and render accept MP4 MOV MKV M4V; depth remains MP4 only',async()=>{
  const f=await fixture(),input=path.join(f.dir,'input.mp4');await fs.writeFile(input,'fixture');
  for(const ext of ['mp4','mov','mkv','m4v']){
    const output=path.join(f.dir,`cloaked.${ext}`);assert.equal(await f.call('cloak:save-as',output),output);
    const result=await f.call('cloak:render',{jobId:`cloak-render-${ext}`,jobs:[{path:input,outputPath:output}],options:{}});assert.deepEqual(result.outputs,[output]);
  }
  assert.deepEqual(f.dialogs[0].filters.flatMap(filter=>filter.extensions),['mp4','mov','mkv','m4v']);
  await assert.rejects(f.call('cloak:render',{jobId:'cloak-render-bad',jobs:[{path:input,outputPath:path.join(f.dir,'bad.avi')}]}),/\.mp4, \.mov, \.mkv/);
  await assert.rejects(f.call('depth:render',{jobId:'render-depth-mov',path:input,outputPath:path.join(f.dir,'depth.mov'),options:{}}),/\.mp4/);
});

function workerFixture(){
  const children=[];
  const childProcess={spawn:()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;child.signalCode=null;child.killed=false;
    child.kill=()=>{child.killed=true;return true;};children.push(child);return child;
  }};
  const {PythonWorker}=executeBundle(workerBundle.outputFiles[0].text,{'node:child_process':childProcess});
  const worker=new PythonWorker({python:process.execPath,backend:temp,models:temp,logs:temp,ffmpeg:path.join(temp,'ffmpeg.exe'),ffprobe:path.join(temp,'ffprobe.exe')},()=>{});
  return {worker,children};
}
test('worker stop awaits close, rejects pending work, and old worker cannot restart',async()=>{
  const {worker,children}=workerFixture();const request=worker.request('cloak-preview-any-id','preview',{});const rejected=assert.rejects(request,/중지/);assert.equal(worker.busy,true);
  let finished=false;const stopping=worker.stop(1000).then(()=>{finished=true;});await rejected;await Promise.resolve();assert.equal(finished,false);assert.equal(children[0].killed,true);assert.equal(worker.busy,false);
  assert.throws(()=>worker.request('new','probe',{}),/중지/);children[0].emit('close',0);await stopping;assert.equal(finished,true);assert.throws(()=>worker.request('new','probe',{}),/중지/);assert.equal(children.length,1);
});
test('worker shutdown has bounded timeout and does not claim success before close',async()=>{
  const {worker,children}=workerFixture();const request=worker.request('probe-id','probe',{});const rejected=assert.rejects(request,/중지/);await assert.rejects(worker.stop(20),/시간이 초과/);await rejected;
  const retry=worker.stop(1000);children[0].emit('close',0);await retry;
});
