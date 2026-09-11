import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {zipSync} from 'fflate';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'magimagic-runtime-'));
await build({entryPoints:['electron/runtime.ts','electron/media-tools.ts','electron/worker.ts'],bundle:true,platform:'node',format:'cjs',outdir:temp,outExtension:{'.js':'.cjs'}});
const require=createRequire(import.meta.url);
const {RuntimeManager}=require(path.join(temp,'runtime.cjs'));
const {MediaToolsResolver,runMediaCommand}=require(path.join(temp,'media-tools.cjs'));
const {workerLaunchConfig}=require(path.join(temp,'worker.cjs'));
after(async()=>{await fs.rm(temp,{recursive:true,force:true});});
let serial=0;
async function folder(label){const dir=path.join(temp,`${serial++} ${label} 공백`);await fs.mkdir(dir,{recursive:true});return dir;}
async function fakePair(dir){await fs.mkdir(dir,{recursive:true});const ffmpeg=path.join(dir,'ffmpeg.exe'),ffprobe=path.join(dir,'ffprobe.exe');await fs.writeFile(ffmpeg,'test');await fs.writeFile(ffprobe,'test');return {ffmpeg,ffprobe};}
const tools={ffmpeg:'C:/Existing Tools/ffmpeg.exe',ffprobe:'C:/Other Tools/ffprobe.exe',version:'8.0.1',probeVersion:'8.0.1',source:'path'};
function fakeRun(calls=[],badPaths=new Set()){
  return async(file,args,input)=>{
    calls.push({file,args,input});if(badPaths.has(file))throw new Error('Invalid executable');
    if(args.includes('-version'))return {stdout:Buffer.from(`${path.basename(file).startsWith('ffprobe')?'ffprobe':'ffmpeg'} version 8.0.1-test\n`),stderr:''};
    if(args.includes('-encoders'))return {stdout:Buffer.from(' V..... libx264\n V..... libx265\n'),stderr:''};
    if(args.includes('-show_entries'))return {stdout:Buffer.from(JSON.stringify({streams:[{codec_name:'h264',width:64,height:64}]})),stderr:''};
    assert.equal(input.length,64*64*3);return {stdout:Buffer.from('test-mp4'),stderr:''};
  };
}
const dummySpec={url:'https://example.invalid/ffmpeg.zip',sha256:'a'.repeat(64),version:'8.1.2'};
test('PATH pair with spaces is reused; repeated ensure does not fetch or copy tools',async()=>{
  const root=await folder('PATH reuse'),pair=await fakePair(path.join(root,'Installed Tools')),calls=[];let fetches=0;
  const resolver=new MediaToolsResolver({userData:path.join(root,'app'),env:{PATH:path.dirname(pair.ffmpeg)},home:path.join(root,'home'),platform:'win32',run:fakeRun(calls),fetch:async()=>{fetches++;throw Error('Must not download');}});
  const first=await resolver.ensure(dummySpec),second=await resolver.ensure(dummySpec);
  assert.equal(first.source,'path');assert.equal(first.ffmpeg,pair.ffmpeg);assert.equal(second.ffprobe,pair.ffprobe);assert.equal(fetches,0);assert.equal(calls.length,5);
  assert.equal(await fs.stat(resolver.binDir).then(()=>true,()=>false),false);
  assert.ok(calls.every(call=>call.file===pair.ffmpeg||call.file===pair.ffprobe));
});
test('distinct environment paths have priority over PATH, quoted paths are accepted',async()=>{
  const root=await folder('override'),a=await fakePair(path.join(root,'A')),b=await fakePair(path.join(root,'B'));
  const resolver=new MediaToolsResolver({userData:path.join(root,'app'),env:{PATH:path.dirname(b.ffmpeg),FFMPEG_PATH:`"${a.ffmpeg}"`,FFPROBE_PATH:b.ffprobe},home:root,platform:'win32',run:fakeRun()});
  const result=await resolver.discover();assert.equal(result.source,'environment');assert.equal(result.ffmpeg,a.ffmpeg);assert.equal(result.ffprobe,b.ffprobe);
});
test('single environment override finds a separate ffprobe on PATH',async()=>{
  const root=await folder('single override'),a=await fakePair(path.join(root,'A')),b=await fakePair(path.join(root,'B'));await fs.unlink(a.ffprobe);
  const resolver=new MediaToolsResolver({userData:path.join(root,'app'),env:{PATH:path.dirname(b.ffprobe),FFMPEG_PATH:a.ffmpeg},home:root,platform:'win32',run:fakeRun()});
  const result=await resolver.discover();assert.equal(result.source,'environment');assert.equal(result.ffmpeg,a.ffmpeg);assert.equal(result.ffprobe,b.ffprobe);assert.match(result.reason,/누락/);
});
test('invalid override falls back to usable PATH and records reason',async()=>{
  const root=await folder('bad override'),a=await fakePair(path.join(root,'A')),b=await fakePair(path.join(root,'B'));
  const resolver=new MediaToolsResolver({userData:path.join(root,'app'),env:{PATH:path.dirname(b.ffmpeg),FFMPEG_PATH:a.ffmpeg,FFPROBE_PATH:a.ffprobe},home:root,platform:'win32',run:fakeRun([],new Set([a.ffmpeg]))});
  const result=await resolver.ensure(dummySpec);assert.equal(result.ffmpeg,b.ffmpeg);assert.equal(result.source,'path');assert.match(result.reason,/Invalid executable/);
});
test('legacy private cache and saved independent paths survive PATH changes',async()=>{
  const root=await folder('legacy'),pair=await fakePair(path.join(root,'Roaming','MagiDepth','tools','bin'));
  const resolver=new MediaToolsResolver({userData:path.join(root,'new app'),env:{PATH:'',APPDATA:path.join(root,'Roaming')},home:root,platform:'win32',run:fakeRun()});
  assert.equal((await resolver.discover()).ffmpeg,pair.ffmpeg);
  const saved=new MediaToolsResolver({userData:path.join(root,'new app'),env:{PATH:''},home:path.join(root,'empty'),platform:'win32',run:fakeRun()});
  assert.equal((await saved.discover()).ffprobe,pair.ffprobe);
});
test('missing pair triggers one verified private download, reused on next call',async()=>{
  const root=await folder('fallback'),pair=await fakePair(path.join(root,'Incomplete'));await fs.unlink(pair.ffprobe);
  const bytes=Buffer.from(zipSync({'ffmpeg-build/bin/ffmpeg.exe':Buffer.from('test'),'ffmpeg-build/bin/ffprobe.exe':Buffer.from('test'),'ffmpeg-build/LICENSE':Buffer.from('test license')}));
  const spec={...dummySpec,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};let downloads=0;
  const resolver=new MediaToolsResolver({userData:path.join(root,'app'),env:{PATH:path.dirname(pair.ffmpeg)},home:root,platform:'win32',run:fakeRun(),fetch:async()=>{downloads++;return new Response(bytes);}});
  const result=await resolver.ensure(spec);assert.equal(result.source,'download');assert.equal(downloads,1);assert.match(result.reason,/찾지/);
  assert.equal((await resolver.ensure(spec)).source,'cache');assert.equal(downloads,1);
  assert.equal(await fs.readFile(pair.ffmpeg,'utf8'),'test');
});
test('missing encoder and malformed ffprobe JSON are rejected',async()=>{
  const root=await folder('bad tools'),pair=await fakePair(root);
  const base=fakeRun();
  const noEncoder=new MediaToolsResolver({userData:path.join(root,'app'),env:{},home:root,platform:'win32',run:async(file,args,input)=>args.includes('-encoders')?{stdout:Buffer.from('libx264'),stderr:''}:base(file,args,input)});
  await assert.rejects(noEncoder.validate({...pair,source:'path'}),/libx265/);
  const badProbe=new MediaToolsResolver({userData:path.join(root,'app2'),env:{},home:root,platform:'win32',run:async(file,args,input)=>args.includes('-show_entries')?{stdout:Buffer.from('{"streams":[]}'),stderr:''}:base(file,args,input)});
  await assert.rejects(badProbe.validate({...pair,source:'path'}),/검증/);
});
test('verified archive in a previous app cache repairs missing binaries without fetching',async()=>{
  const root=await folder('legacy archive'),oldTools=path.join(root,'Roaming','DepthDesk','tools');await fs.mkdir(oldTools,{recursive:true});
  const bytes=Buffer.from(zipSync({'ffmpeg-build/bin/ffmpeg.exe':Buffer.from('test'),'ffmpeg-build/bin/ffprobe.exe':Buffer.from('test')}));
  await fs.writeFile(path.join(oldTools,'ffmpeg-download.zip'),bytes);
  const resolver=new MediaToolsResolver({userData:path.join(root,'app'),env:{APPDATA:path.join(root,'Roaming')},home:root,platform:'win32',run:fakeRun(),fetch:async()=>{throw Error('Existing archive must be reused');}});
  const result=await resolver.ensure({...dummySpec,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});assert.equal(result.source,'cache');
  assert.equal(await fs.stat(path.join(root,'app','tools','ffmpeg-download.zip')).then(()=>true,()=>false),false);
});
test('failed SHA validation never publishes executables',async()=>{
  const root=await folder('integrity');
  const resolver=new MediaToolsResolver({userData:root,env:{},home:path.join(root,'home'),platform:'win32',fetch:async()=>new Response('bad archive'),run:fakeRun()});
  await assert.rejects(resolver.ensure(dummySpec),/무결성/);
  assert.equal(await fs.stat(resolver.binDir).then(()=>true,()=>false),false);
});
test('real command runner keeps arguments with spaces literal, no shell interpolation',async()=>{
  const result=await runMediaCommand(process.execPath,['-e','process.stdout.write(process.argv[1])','space 한글 & $data']);
  assert.equal(result.stdout.toString(),'space 한글 & $data');
});
test('worker passes independently resolved media paths and selected daemon',()=>{
  const backend=path.resolve(temp,'backend');const config=workerLaunchConfig({python:process.execPath,backend,models:path.join(temp,'models'),logs:temp,ffmpeg:path.resolve(temp,'FFmpeg Tool','ffmpeg.exe'),ffprobe:path.resolve(temp,'Probe Tool','ffprobe.exe'),daemonEntry:'cloak_daemon.py'});
  assert.equal(config.entry,path.join(backend,'cloak_daemon.py'));assert.equal(config.env.FFMPEG_PATH,path.resolve(temp,'FFmpeg Tool','ffmpeg.exe'));assert.equal(config.env.FFPROBE_PATH,path.resolve(temp,'Probe Tool','ffprobe.exe'));
  assert.throws(()=>workerLaunchConfig({python:process.execPath,backend,models:temp,logs:temp,ffmpeg:'relative.exe',ffprobe:'relative.exe'}),/절대/);
});

const requirements={'numpy':'2.2.6','opencv-python-headless':'4.11.0.86','transformers':'4.50.3'};
const manifest={python:{version:'3.13.14',sha256:''},pip:{sha256:''},torch:'2.7.1',torchvision:'0.22.1',cuda:'cu128',ffmpeg:dummySpec};
async function runtimeFixture({full=true,cloak=true,hasMedia=true,hasPython=true}={}){
  const root=await folder('runtime'),resources=path.join(root,'resources'),backend=path.join(root,'backend'),userData=path.join(root,'app');
  await fs.mkdir(resources,{recursive:true});await fs.mkdir(backend,{recursive:true});
  const pythonZip=Buffer.from(zipSync({'python.exe':Buffer.from('test python')})),pipZip=Buffer.from(zipSync({'pip/__init__.py':Buffer.from('test pip')}));
  await fs.writeFile(path.join(resources,'python-embed.zip'),pythonZip);await fs.writeFile(path.join(resources,'pip.whl'),pipZip);
  await fs.writeFile(path.join(resources,'manifest.json'),JSON.stringify({...manifest,python:{...manifest.python,sha256:crypto.createHash('sha256').update(pythonZip).digest('hex')},pip:{sha256:crypto.createHash('sha256').update(pipZip).digest('hex')}}));
  await fs.writeFile(path.join(backend,'requirements.txt'),Object.entries(requirements).map(([name,version])=>`${name}==${version}`).join('\n'));
  const runtimeDir=path.join(userData,'engine','python-3.13-cu128-v1');await fs.mkdir(runtimeDir,{recursive:true});if(hasPython)await fs.writeFile(path.join(runtimeDir,'python.exe'),'existing-python');
  await fs.writeFile(path.join(runtimeDir,'ready.json'),'OLD_DEPTH_MARKER');
  const calls=[],events=[];let mediaReady=hasMedia,mediaInstalls=0,extracts=0;
  const caps={python:'3.13.14',versions:{pip:'25.3',...(cloak?{'numpy':requirements.numpy,'opencv-python-headless':requirements['opencv-python-headless']}:{}),...(full?{...requirements,torch:'2.7.1+cu128',torchvision:'0.22.1+cu128'}:{})},cloak};
  if(!hasPython){caps.versions={};caps.cloak=false;}
  const media={lastReason:'No media tools',discover:async()=>mediaReady?tools:undefined,ensure:async()=>{mediaReady=true;mediaInstalls++;return tools;}};
  const manager=new RuntimeManager(userData,resources,backend,state=>events.push(state),undefined,{
    media,
    extract:async(archive,directory)=>{extracts++;await fs.mkdir(directory,{recursive:true});if(archive.endsWith('python-embed.zip'))await fs.writeFile(path.join(directory,'python.exe'),'new-python');else caps.versions.pip='25.3';},
    runPython:async args=>{
      calls.push(args);
      if(args[1]?.includes('MAGIMAGIC_RUNTIME_JSON:'))return `MAGIMAGIC_RUNTIME_JSON:${JSON.stringify(caps)}\n`;
      if(args[0]==='-m'){
        if(args.some(arg=>arg.startsWith('torch=='))){caps.versions.torch='2.7.1+cu128';caps.versions.torchvision='0.22.1+cu128';}
        if(args.includes('-r'))Object.assign(caps.versions,requirements);
        for(const name of ['numpy','opencv-python-headless'])if(args.includes(`${name}==${requirements[name]}`))caps.versions[name]=requirements[name];
        caps.cloak=!!caps.versions.numpy&&!!caps.versions['opencv-python-headless'];return 'pip success';
      }
      return 'ENGINE_OK';
    },
  });
  return {manager,root,backend,runtimeDir,calls,events,caps,stats:()=>({mediaInstalls,extracts})};
}
test('complete existing runtime: repeated depth/Cloak install makes no pip, extraction or download',async()=>{
  const f=await runtimeFixture();assert.equal((await f.manager.inspect()).ready,true);await f.manager.install();await f.manager.install();await f.manager.installCloak();
  assert.equal(f.calls.filter(args=>args[0]==='-m').length,0);assert.deepEqual(f.stats(),{mediaInstalls:0,extracts:0});assert.equal(f.manager.mediaTools.ffmpeg,tools.ffmpeg);
  assert.equal(await fs.readFile(path.join(f.runtimeDir,'ready.json'),'utf8'),'OLD_DEPTH_MARKER');
});
test('cached inspect batches do not respawn Python; force and fingerprint changes refresh',async()=>{
  const f=await runtimeFixture();await f.manager.inspect();const count=f.calls.length;
  await Promise.all(Array.from({length:500},()=>f.manager.inspect()));assert.equal(f.calls.length,count);
  await f.manager.inspect(true);assert.equal(f.calls.length,count+1);
  await fs.appendFile(path.join(f.backend,'requirements.txt'),'\n# requirement metadata changed\n');
  await f.manager.inspect();assert.equal(f.calls.length,count+2);
});
test('missing tools repair never bootstraps Python or invokes Torch/pip',async()=>{
  const f=await runtimeFixture({hasMedia:false});assert.equal((await f.manager.inspect()).ready,false);
  assert.equal((await f.manager.install()).ready,true);assert.equal(f.calls.filter(args=>args[0]==='-m').length,0);assert.deepEqual(f.stats(),{mediaInstalls:1,extracts:0});
});
test('requirements change installs only missing dependencies, not Torch',async()=>{
  const f=await runtimeFixture();delete f.caps.versions.transformers;
  assert.equal((await f.manager.install()).ready,true);const pip=f.calls.filter(args=>args[0]==='-m');assert.equal(pip.length,1);assert.ok(pip[0].includes('-r'));assert.equal(pip[0].some(arg=>arg.startsWith('torch==')),false);assert.equal(f.stats().extracts,0);
});
test('Cloak-only install uses only numpy/OpenCV and preserves depth marker',async()=>{
  const f=await runtimeFixture({full:false,cloak:false});const status=await f.manager.installCloak();assert.equal(status.cloakReady,true);assert.equal(status.ready,false);
  const pip=f.calls.filter(args=>args[0]==='-m');assert.equal(pip.length,1);assert.ok(pip[0].includes('numpy==2.2.6'));assert.ok(pip[0].includes('opencv-python-headless==4.11.0.86'));assert.equal(pip[0].some(arg=>/torch|transformers/.test(arg)),false);
  assert.equal(await fs.readFile(path.join(f.runtimeDir,'ready.json'),'utf8'),'OLD_DEPTH_MARKER');await f.manager.installCloak();assert.equal(f.calls.filter(args=>args[0]==='-m').length,1);
});
test('fresh Cloak bootstrap extracts embedded Python/pip once, never Torch',async()=>{
  const f=await runtimeFixture({full:false,cloak:false,hasPython:false});const status=await f.manager.installCloak();assert.equal(status.cloakReady,true);assert.equal(status.ready,false);assert.equal(f.stats().extracts,2);
  await f.manager.installCloak();assert.equal(f.stats().extracts,2);assert.equal(f.calls.filter(args=>args[0]==='-m').length,1);
});
test('existing Cloak environment upgrades to Depth without re-extracting Python',async()=>{
  const f=await runtimeFixture({full:false,cloak:true});assert.equal((await f.manager.inspect()).cloakReady,true);assert.equal((await f.manager.install()).ready,true);
  const pip=f.calls.filter(args=>args[0]==='-m');assert.equal(pip.length,2);assert.ok(pip[0].includes('torch==2.7.1'));assert.ok(pip[1].includes('-r'));assert.equal(f.stats().extracts,0);
});
test('concurrent repeated installation is single-flight',async()=>{
  const f=await runtimeFixture({full:false,cloak:false});await Promise.all([f.manager.installCloak(),f.manager.installCloak(),f.manager.installCloak()]);assert.equal(f.calls.filter(args=>args[0]==='-m').length,1);
});
