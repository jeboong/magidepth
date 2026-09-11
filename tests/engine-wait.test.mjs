import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),temp=await fs.mkdtemp(path.join(os.tmpdir(),'magimagic-wait-'));
after(async()=>{await fs.rm(temp,{recursive:true,force:true});});
const bundles={};
for(const name of ['worker','runtime'])bundles[name]=(await build({entryPoints:[`electron/${name}.ts`],bundle:true,platform:'node',format:'cjs',write:false})).outputFiles[0].text;
function fixture(name){
  const children=[];
  const childProcess={spawn:()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;child.signalCode=null;child.killed=false;
    child.kill=()=>{child.killed=true;return true;};children.push(child);return child;
  }};
  const module={exports:{}};
  new Function('require','module','exports',bundles[name])(key=>key==='node:child_process'?childProcess:require(key),module,module.exports);
  return {...module.exports,children};
}
function workerFixture(){
  const f=fixture('worker');
  const worker=new f.PythonWorker({python:process.execPath,backend:temp,models:temp,logs:temp,ffmpeg:path.join(temp,'ffmpeg.exe'),ffprobe:path.join(temp,'ffprobe.exe')},()=>{});
  return {...f,worker};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function progress(child,id){child.stdout.write(JSON.stringify({id,type:'progress',data:{progress:.1,stage:'verify',message:'working'}})+'\n');}
function result(child,id,value={}){child.stdout.write(JSON.stringify({id,type:'result',data:value})+'\n');}

test('unresponsive worker is bounded, clears busy and waits for close before replacement',async()=>{
  const {worker,children}=workerFixture();
  const work=worker.request('catalog','catalog',{}, {timeoutMs:30});
  await assert.rejects(work,error=>error.name==='WorkerTimeoutError');
  assert.equal(worker.busy,false);assert.equal(worker.unusable,true);assert.equal(children[0].killed,true);
  assert.throws(()=>worker.request('retry','catalog',{}),/중지/);
  const stopping=worker.stop();children[0].emit('close',0);await stopping;
});

test('download activity resets idle watchdog while total deadline still bounds noisy hangs',async()=>{
  const {worker,children}=workerFixture();
  const work=worker.request('download','download',{}, {idleTimeoutMs:80,timeoutMs:1000});
  for(let i=0;i<5;i++){await sleep(25);progress(children[0],'download');}
  result(children[0],'download',{complete:true});assert.deepEqual(await work,{complete:true});
  const noisy=worker.request('noisy','catalog',{}, {idleTimeoutMs:80,timeoutMs:100});
  const handled=assert.rejects(noisy,error=>error.name==='WorkerTimeoutError');
  const interval=setInterval(()=>progress(children[0],'noisy'),15);
  await handled;clearInterval(interval);
  const stopping=worker.stop();children[0].emit('close',0);await stopping;
});

test('silent download and duplicate IDs cannot leave pending requests stranded',async()=>{
  const {worker,children}=workerFixture();
  const work=worker.request('same','download',{}, {idleTimeoutMs:30});
  const handled=assert.rejects(work,error=>error.name==='WorkerTimeoutError');
  await assert.rejects(worker.request('same','catalog',{}),/요청 ID/);
  await handled;assert.equal(worker.busy,false);
  const stopping=worker.stop();children[0].emit('close',0);await stopping;
});

test('runtime validation and silent pip have deadlines and cannot overlap a live expired process',async()=>{
  const {RuntimeManager,children}=fixture('runtime');
  const manager=new RuntimeManager(temp,temp,temp,()=>{},process.execPath,{validationTimeoutMs:30,installIdleTimeoutMs:40,installTimeoutMs:500});
  await assert.rejects(manager.execute(['-c','test']),/검증 응답 시간이 초과/);
  assert.equal(children[0].killed,true);
  assert.throws(()=>manager.execute(['-c','retry']),/이전 엔진 프로세스/);
  children[0].emit('close',1);
  const pip=manager.execute(['-m','pip'],.2);
  await assert.rejects(pip,/설치가 오랫동안 응답하지/);assert.equal(children[1].killed,true);
  children[1].emit('close',1);
  const retry=manager.execute(['-c','success']);children[2].stdout.write('OK');children[2].emit('close',0);
  assert.equal(await retry,'OK');
});

test('pip output resets idle clock, completion cancels every timer',async()=>{
  const {RuntimeManager,children}=fixture('runtime');
  const manager=new RuntimeManager(temp,temp,temp,()=>{},process.execPath,{installIdleTimeoutMs:80,installTimeoutMs:1000});
  const pip=manager.execute(['-m','pip'],.2);
  for(let i=0;i<5;i++){await sleep(25);children[0].stdout.write('Installing packages\n');}
  children[0].emit('close',0);await pip;await sleep(100);
  assert.equal(children[0].killed,false);
});

test('even an empty model error message terminates setup instead of leaving installing true',()=>{
  const {RuntimeManager}=fixture('runtime');
  const manager=new RuntimeManager(temp,temp,temp,()=>{},process.execPath);
  manager.reportModelSetup(0,'Preparing');assert.equal(manager.status.installing,true);
  manager.reportModelSetup(0,'Failed',false,'');assert.equal(manager.status.installing,false);
});
