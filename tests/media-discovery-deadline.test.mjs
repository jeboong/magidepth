import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'magimagic-media-deadline-'));
await build({entryPoints:['electron/media-tools.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'media.cjs')});
const require=createRequire(import.meta.url);
const {MediaToolsResolver,runMediaCommand}=require(path.join(temp,'media.cjs'));
after(async()=>{await fs.rm(temp,{recursive:true,force:true});});
let serial=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(){const dir=path.join(temp,String(serial++));await fs.mkdir(dir);return dir;}
async function pair(root,name){const dir=path.join(root,name);await fs.mkdir(dir);for(const file of ['ffmpeg.exe','ffprobe.exe'])await fs.writeFile(path.join(dir,file),'test');return dir;}
const good=async(file,args)=>{
  if(args.includes('-version'))return {stdout:Buffer.from(`${path.basename(file).startsWith('ffprobe')?'ffprobe':'ffmpeg'} version 8.0.1\n`),stderr:''};
  if(args.includes('-encoders'))return {stdout:Buffer.from('libx264 libx265'),stderr:''};
  if(args.includes('-show_entries'))return {stdout:Buffer.from(JSON.stringify({streams:[{codec_name:'h264',width:64,height:64}]})),stderr:''};
  return {stdout:Buffer.from('test mp4'),stderr:''};
};
const base=root=>({userData:path.join(root,'app'),home:path.join(root,'home'),platform:'win32',discoveryTimeoutMs:500,filesystemTimeoutMs:25});
const spec={url:'https://example.invalid/never.zip',sha256:'a'.repeat(64),version:'8.0'};

test('discovery timeout is single-flight, ends checking, never downloads, and allows retry',async()=>{
  const root=await fixture(),bin=await pair(root,'bin');let hanging=true,fetches=0,calls=0,release;
  const gate=new Promise(resolve=>release=resolve);
  const resolver=new MediaToolsResolver({...base(root),discoveryTimeoutMs:80,env:{PATH:bin},run:async(...args)=>{calls++;if(hanging)await gate;return good(...args);},fetch:async()=>{fetches++;throw Error('Must never fetch after incomplete discovery');}});
  const first=resolver.discover(),same=resolver.discover();assert.equal(first,same);
  await assert.rejects(first,error=>error.name==='MediaDiscoveryTimeoutError');assert.equal(calls,3);
  await assert.rejects(resolver.ensure(spec),error=>error.name==='MediaDiscoveryTimeoutError');assert.equal(fetches,0);
  hanging=false;release();await delay(5);
  const result=await resolver.discover();assert.equal(result.ffmpeg,path.join(bin,'ffmpeg.exe'));assert.equal(fetches,0);
});

test('failed FFmpeg metadata is checked once per discovery, not once per ffprobe partner',async()=>{
  const root=await fixture(),bins=await Promise.all(['bad1','bad2','bad3','good'].map(name=>pair(root,name)));
  const failures=new Set(bins.slice(0,3).map(dir=>path.join(dir,'ffmpeg.exe'))),calls=[];
  const resolver=new MediaToolsResolver({...base(root),env:{PATH:bins.join(';')},run:async(file,args)=>{
    calls.push({file,args});if(failures.has(file))throw Error('Invalid executable');return good(file,args);
  }});
  assert.equal((await resolver.discover()).ffmpeg,path.join(bins[3],'ffmpeg.exe'));
  assert.equal(calls.filter(call=>failures.has(call.file)&&call.args.includes('-version')).length,3);
  assert.equal(calls.filter(call=>failures.has(call.file)&&call.args.includes('-encoders')).length,3);
});

test('one unresponsive PATH lookup does not hide an otherwise usable system pair',async()=>{
  const root=await fixture(),bin=await pair(root,'good'),stalled=path.join(root,'network-unavailable');
  const saved=fs.stat;let release;const gate=new Promise(resolve=>release=resolve);
  fs.stat=async(file,...args)=>{if(String(file).startsWith(stalled)){await gate;throw Object.assign(Error('Unavailable'),{code:'ENOENT'});}return saved(file,...args);};
  try{
    const resolver=new MediaToolsResolver({...base(root),env:{PATH:[bin,stalled].join(';')},run:good});
    assert.equal((await resolver.discover()).ffmpeg,path.join(bin,'ffmpeg.exe'));
  }finally{release();fs.stat=saved;}
});

test('unresolved filesystem checks are not misreported as missing tools or auto-downloaded',async()=>{
  const root=await fixture(),stalled=path.join(root,'network-unavailable');let fetches=0,release;const gate=new Promise(resolve=>release=resolve),saved=fs.stat;
  fs.stat=async(file,...args)=>{if(String(file).startsWith(stalled)){await gate;throw Error('Unavailable');}return saved(file,...args);};
  try{
    const resolver=new MediaToolsResolver({...base(root),env:{PATH:stalled},run:good,fetch:async()=>{fetches++;throw Error('No download');}});
    await assert.rejects(resolver.ensure(spec),error=>error.name==='MediaDiscoveryTimeoutError');assert.equal(fetches,0);
  }finally{release();fs.stat=saved;}
});

test('abort of real media command kills its child and settles without waiting twenty seconds',async()=>{
  const controller=new AbortController(),start=performance.now();
  const promise=runMediaCommand(process.execPath,['-e','setInterval(()=>{},1000)'],undefined,controller.signal);
  const timer=setTimeout(()=>controller.abort(new Error('Test discovery deadline')),100);
  try{await assert.rejects(promise,/Test discovery deadline/);assert.ok(performance.now()-start<3000);}
  finally{clearTimeout(timer);}
});

test('fallback archive discovery is bounded and cannot download after a new filesystem stall',async()=>{
  const root=await fixture(),stalled=path.join(root,'disconnected');let fetches=0,release,lookups=0;
  const gate=new Promise(resolve=>release=resolve),saved=fs.stat;
  fs.stat=async(file,...args)=>{
    if(String(file)===path.join(stalled,'ffmpeg.exe')&&++lookups>1){await gate;throw Error('Unavailable');}
    return saved(file,...args);
  };
  try{
    const resolver=new MediaToolsResolver({...base(root),env:{PATH:stalled},run:good,fetch:async()=>{fetches++;throw Error('No download');}});
    await assert.rejects(resolver.ensure(spec),error=>error.name==='MediaDiscoveryTimeoutError');assert.equal(fetches,0);assert.ok(lookups>=2);
  }finally{release();fs.stat=saved;}
});

test('missing-tool preparation bounds a silent download body and cancels its reader',async()=>{
  const root=await fixture();let cancelled=false;
  const resolver=new MediaToolsResolver({...base(root),env:{},prepareTimeoutMs:80,run:good,fetch:async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel(){cancelled=true;}}))});
  await assert.rejects(resolver.ensure(spec),/준비 응답 시간이 초과/);await delay(5);assert.equal(cancelled,true);
  assert.equal(await fs.stat(resolver.binDir).then(()=>true,()=>false),false);
});

test('a late prepare fetch result cannot publish tools or emit stale setup progress',async()=>{
  const root=await fixture(),reports=[];let release;
  const gate=new Promise(resolve=>release=resolve);
  const resolver=new MediaToolsResolver({...base(root),env:{},prepareTimeoutMs:50,run:good,report:message=>reports.push(message),fetch:()=>gate});
  await assert.rejects(resolver.ensure(spec),/준비 응답 시간이 초과/);const count=reports.length;
  release(new Response('late result'));await delay(30);
  assert.equal(reports.length,count);assert.equal(await fs.stat(resolver.binDir).then(()=>true,()=>false),false);
});
