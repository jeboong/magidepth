import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {setMaxListeners} from 'node:events';
import {unzipSync} from 'fflate';

export interface MediaTools {
  ffmpeg:string; ffprobe:string; version:string; probeVersion:string;
  source:'environment'|'path'|'cache'|'download'; reason?:string;
}
export interface MediaToolsSpec {url:string;sha256:string;version:string}
export type CommandRunner=(file:string,args:string[],input?:Buffer,signal?:AbortSignal)=>Promise<{stdout:Buffer;stderr:string}>;
export interface MediaToolsOptions {
  userData:string; resources?:string; env?:NodeJS.ProcessEnv; platform?:NodeJS.Platform;
  home?:string; legacyDirs?:string[]; run?:CommandRunner; fetch?:typeof fetch;
  report?:(message:string,progress?:number)=>void;
  /** Testable safety limits; discovery never treats an incomplete check as permission to download. */
  discoveryTimeoutMs?:number; filesystemTimeoutMs?:number; prepareTimeoutMs?:number;
}

class MediaDiscoveryTimeoutError extends Error {constructor(){super('설치된 FFmpeg/ffprobe 확인 시간이 초과되었습니다. 기존 도구는 변경하지 않았습니다. 연결되지 않은 네트워크 경로나 환경 변수의 도구 경로를 확인한 뒤 다시 시도해 주세요.');this.name='MediaDiscoveryTimeoutError';}}
class MediaLookupTimeoutError extends Error {constructor(){super('영상 도구 파일 경로 응답 시간이 초과되었습니다.');this.name='MediaLookupTimeoutError';}}
interface DiscoveryContext {signal:AbortSignal;incomplete:boolean;metadata:Map<string,Promise<{stdout:Buffer;stderr:string}>>}
function bounded<T>(promise:Promise<T>,signal:AbortSignal,timeoutMs?:number):Promise<T>{
  return new Promise((resolve,reject)=>{
    let settled=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const finish=(error:unknown,value?:T)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
    const abort=()=>finish(signal.reason??new MediaDiscoveryTimeoutError());
    if(timeoutMs!==undefined)timer=setTimeout(()=>finish(new MediaLookupTimeoutError()),timeoutMs);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    promise.then(value=>finish(undefined,value),error=>finish(error));
  });
}

/** No shell: paths containing spaces or non-ASCII characters remain a single executable. */
export const runMediaCommand:CommandRunner=(file,args,input,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason??new MediaDiscoveryTimeoutError());return;}
  const child=spawn(file,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks:Buffer[]=[];let length=0,stderr='',finished=false;
  const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve({stdout:Buffer.concat(chunks),stderr});};
  const abort=()=>{child.kill();finish(signal?.reason??new MediaDiscoveryTimeoutError());};
  const timer=setTimeout(()=>{child.kill();finish(new Error('영상 도구 응답 시간 초과'));},20000);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>8*1024*1024){child.kill();finish(new Error('영상 도구 응답 크기 초과'));}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-20000);});
  child.once('error',error=>finish(error));
  child.once('close',code=>finish(code===0?undefined:new Error(`${path.basename(file)} 실행 실패 (${code}): ${stderr.slice(-500)}`)));
  child.stdin.on('error',()=>{});child.stdin.end(input);
});

interface Candidate {ffmpeg:string;ffprobe:string;source:MediaTools['source']}
const trimPath=(value:string)=>value.trim().replace(/^"(.*)"$/,'$1');
const hash=(bytes:Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');

/** Discovers a usable pair before downloading anything. Never copies external installations. */
export class MediaToolsResolver {
  private env:NodeJS.ProcessEnv;
  private platform:NodeJS.Platform;
  private run:CommandRunner;
  private verified=new Map<string,{fingerprint:string;tools:MediaTools}>();
  private discovering?:Promise<MediaTools|undefined>;
  lastReason='';
  constructor(private options:MediaToolsOptions){this.env=options.env??process.env;this.platform=options.platform??process.platform;this.run=options.run??runMediaCommand;}
  get binDir(){return path.join(this.options.userData,'tools','bin');}
  private get filename(){return this.platform==='win32'?{ffmpeg:'ffmpeg.exe',ffprobe:'ffprobe.exe'}:{ffmpeg:'ffmpeg',ffprobe:'ffprobe'};}
  private pair(dir:string,source:MediaTools['source']):Candidate{return {ffmpeg:path.join(dir,this.filename.ffmpeg),ffprobe:path.join(dir,this.filename.ffprobe),source};}
  private async lookup<T>(work:Promise<T>,context?:DiscoveryContext):Promise<T|undefined>{
    try{return await(context?bounded(work,context.signal,this.options.filesystemTimeoutMs??2000):work);}
    catch(error){if(context?.signal.aborted)throw context.signal.reason;if(error instanceof MediaLookupTimeoutError&&context)context.incomplete=true;return undefined;}
  }
  private async isFile(file:string,context?:DiscoveryContext){return !!(await this.lookup(fs.stat(file),context))?.isFile();}
  private async candidates(context?:DiscoveryContext){
    const candidates:Candidate[]=[];
    const envValue=(key:string)=>Object.entries(this.env).find(([name])=>name.toLowerCase()===key.toLowerCase())?.[1];
    const pathDirs=(envValue('PATH')??'').split(this.platform==='win32'?';':':').map(trimPath).filter(dir=>dir&&path.isAbsolute(dir));
    const pathPairs=pathDirs.map(dir=>this.pair(dir,'path'));
    // Enumerate individual tools too: FFmpeg and ffprobe need not share a folder.
    const pathFFmpeg:string[]=[],pathFFprobe:string[]=[];
    const present=await Promise.all(pathPairs.map(async pair=>({pair,ff:await this.isFile(pair.ffmpeg,context),probe:await this.isFile(pair.ffprobe,context)})));
    for(const item of present){if(item.ff)pathFFmpeg.push(item.pair.ffmpeg);if(item.probe)pathFFprobe.push(item.pair.ffprobe);}
    const overrideFF=envValue('MAGIMAGIC_FFMPEG_PATH')||envValue('FFMPEG_PATH');
    const overrideProbe=envValue('MAGIMAGIC_FFPROBE_PATH')||envValue('FFPROBE_PATH');
    if(overrideFF||overrideProbe){
      const ff=overrideFF?trimPath(overrideFF):undefined,probe=overrideProbe?trimPath(overrideProbe):undefined;
      const ffChoices=ff?[ff]:[...(probe?[path.join(path.dirname(probe),this.filename.ffmpeg)]:[]),...pathFFmpeg];
      const probeChoices=probe?[probe]:[...(ff?[path.join(path.dirname(ff),this.filename.ffprobe)]:[]),...pathFFprobe];
      for(const ffmpeg of ffChoices)for(const ffprobe of probeChoices)candidates.push({ffmpeg,ffprobe,source:'environment'});
      if(!ffChoices.length||!probeChoices.length)this.lastReason='환경 변수에 지정한 영상 도구의 짝을 찾지 못했습니다.';
    }
    for(const ffmpeg of pathFFmpeg)for(const ffprobe of pathFFprobe)candidates.push({ffmpeg,ffprobe,source:'path'});
    // Persisted distinct paths cover a changed/stale PATH after an application update.
    const savedText=await this.lookup(fs.readFile(path.join(this.options.userData,'tools','resolved.json'),'utf8'),context);
    try{const saved=JSON.parse(savedText??'');if(typeof saved.ffmpeg==='string'&&typeof saved.ffprobe==='string')candidates.push({ffmpeg:saved.ffmpeg,ffprobe:saved.ffprobe,source:'cache'});}catch{}
    const home=this.options.home??os.homedir();
    const cacheDirs=[this.binDir,...(this.options.legacyDirs??[])];
    if(this.options.resources)cacheDirs.push(path.join(this.options.resources,'bin'));
    for(const base of [envValue('APPDATA'),envValue('LOCALAPPDATA')].filter((value):value is string=>!!value)){
      for(const app of ['MagiDepth','magidepth','DepthDesk','MagiMagic'])cacheDirs.push(path.join(base,app,'tools','bin'));
    }
    cacheDirs.push(path.join(home,'scoop','apps','ffmpeg','current','bin'));
    if(this.platform==='win32'){
      const local=envValue('LOCALAPPDATA');
      if(local){
        cacheDirs.push(path.join(local,'Microsoft','WinGet','Links'));
        const packages=path.join(local,'Microsoft','WinGet','Packages');
        for(const entry of await this.lookup(fs.readdir(packages,{withFileTypes:true}),context)??[])if(entry.isDirectory()&&entry.name.startsWith('Gyan.FFmpeg_')){
          const pkg=path.join(packages,entry.name);
          for(const version of await this.lookup(fs.readdir(pkg,{withFileTypes:true}),context)??[])if(version.isDirectory()&&version.name.startsWith('ffmpeg-'))cacheDirs.push(path.join(pkg,version.name,'bin'));
        }
      }
      const programFiles=envValue('ProgramFiles');if(programFiles)cacheDirs.push(path.join(programFiles,'ffmpeg','bin'));
    }
    for(const dir of cacheDirs)candidates.push(this.pair(dir,'cache'));
    const seen=new Set<string>();
    return candidates.filter(candidate=>{const key=`${candidate.ffmpeg}\0${candidate.ffprobe}`.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  }
  async validate(candidate:Candidate,context?:DiscoveryContext):Promise<MediaTools>{
    const {ffmpeg,ffprobe}=candidate;
    if(!path.isAbsolute(ffmpeg)||!path.isAbsolute(ffprobe)||ffmpeg.includes('\0')||ffprobe.includes('\0'))throw new Error('영상 도구는 절대 경로여야 합니다.');
    // Windows scripts are not executables and must never be launched through a shell.
    if(this.platform==='win32'&&(!/\.exe$/i.test(ffmpeg)||!/\.exe$/i.test(ffprobe)))throw new Error('영상 도구는 .exe 파일이어야 합니다.');
    const [ffStat,probeStat]=await Promise.all([this.lookup(fs.stat(ffmpeg),context),this.lookup(fs.stat(ffprobe),context)]);
    if(!ffStat||!probeStat)throw new Error('FFmpeg 또는 ffprobe 파일 경로를 확인하지 못했습니다.');
    if(!ffStat.isFile()||!probeStat.isFile())throw new Error('FFmpeg 또는 ffprobe가 파일이 아닙니다.');
    const key=`${ffmpeg}\0${ffprobe}`,fingerprint=[ffStat.size,ffStat.mtimeMs,probeStat.size,probeStat.mtimeMs].join(':');
    const cached=this.verified.get(key);if(cached?.fingerprint===fingerprint)return {...cached.tools,source:candidate.source};
    const run:CommandRunner=(file,args,input)=>{
      if(!context)return this.run(file,args,input);
      if(context.signal.aborted)return Promise.reject(context.signal.reason);
      // A broken executable must not be retried once for every possible partner.
      const key=JSON.stringify([file,args]);
      if(!input&&(args.includes('-version')||args.includes('-encoders'))){
        let pending=context.metadata.get(key);
        if(!pending){pending=bounded(this.run(file,args,input,context.signal),context.signal);context.metadata.set(key,pending);}return pending;
      }
      return bounded(this.run(file,args,input,context.signal),context.signal);
    };
    const [ff,probe,encoders]=await Promise.all([run(ffmpeg,['-hide_banner','-version']),run(ffprobe,['-hide_banner','-version']),run(ffmpeg,['-hide_banner','-encoders'])]);
    const version=/^ffmpeg version\s+(\S+)/m.exec(ff.stdout.toString())?.[1];
    const probeVersion=/^ffprobe version\s+(\S+)/m.exec(probe.stdout.toString())?.[1];
    if(!version||!probeVersion)throw new Error('FFmpeg/ffprobe 버전 응답을 확인하지 못했습니다.');
    if(!/\blibx264\b/.test(encoders.stdout.toString())||!/\blibx265\b/.test(encoders.stdout.toString()))throw new Error('H.264(libx264) 또는 HEVC(libx265) 인코더가 없습니다.');
    // Exercise the actual raw-frame, fps_mode, MP4 export and JSON probing workflow.
    const encoded=await run(ffmpeg,['-hide_banner','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size','64x64','-framerate','1','-i','pipe:0','-frames:v','1','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-fps_mode','passthrough','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],Buffer.alloc(64*64*3,128));
    const result=await run(ffprobe,['-v','error','-show_entries','stream=codec_name,width,height','-of','json','pipe:0'],encoded.stdout);
    const stream=JSON.parse(result.stdout.toString()).streams?.[0];
    if(stream?.codec_name!=='h264'||stream.width!==64||stream.height!==64)throw new Error('FFmpeg 시험 인코딩 또는 ffprobe 분석 검증에 실패했습니다.');
    if(context?.signal.aborted)throw context.signal.reason;
    const tools:MediaTools={...candidate,version,probeVersion};this.verified.set(key,{fingerprint,tools});return tools;
  }
  private async remember(tools:MediaTools){try{await fs.mkdir(path.dirname(this.binDir),{recursive:true});await fs.writeFile(path.join(path.dirname(this.binDir),'resolved.json'),JSON.stringify(tools,null,2));}catch{/* Read-only cache is not a reason to reject working system tools. */}}
  discover():Promise<MediaTools|undefined>{
    if(this.discovering)return this.discovering;
    const controller=new AbortController(),context:DiscoveryContext={signal:controller.signal,incomplete:false,metadata:new Map()};
    // Each parallel PATH lookup observes this one bounded discovery operation.
    setMaxListeners(0,context.signal);
    const timer=setTimeout(()=>controller.abort(new MediaDiscoveryTimeoutError()),this.options.discoveryTimeoutMs??60000);
    this.discovering=bounded(this.discoverCandidates(context),context.signal).finally(()=>{clearTimeout(timer);this.discovering=undefined;});
    return this.discovering;
  }
  private async discoverCandidates(context:DiscoveryContext):Promise<MediaTools|undefined>{
    this.lastReason='';const failures:string[]=[];
    for(const candidate of await this.candidates(context)){
      // Missing legacy folders are normal; explicit override failures are worth reporting.
      if(!await this.isFile(candidate.ffmpeg,context)||!await this.isFile(candidate.ffprobe,context)){
        if(candidate.source==='environment')failures.push('환경 변수의 FFmpeg/ffprobe 경로가 없거나 짝이 누락되었습니다.');continue;
      }
      try{
        const tools=await this.validate(candidate,context);if(failures.length)tools.reason=failures.join(' ').slice(0,1200);
        // A slow/read-only preference cache must not invalidate usable system tools.
        try{await bounded(this.remember(tools),context.signal,this.options.filesystemTimeoutMs??2000);}catch{if(context.signal.aborted)throw context.signal.reason;}
        return tools;
      }
      catch(error){if(context.signal.aborted)throw context.signal.reason;if(error instanceof MediaLookupTimeoutError)context.incomplete=true;failures.push(`${candidate.source}: ${candidate.ffmpeg}: ${error instanceof Error?error.message:String(error)}`);}
    }
    if(context.incomplete)throw new MediaDiscoveryTimeoutError();
    this.lastReason=failures.join(' ').slice(0,1800)||this.lastReason||'사용 가능한 FFmpeg와 ffprobe를 환경 변수, PATH, 기존 캐시에서 찾지 못했습니다.';return undefined;
  }
  async ensure(spec:MediaToolsSpec):Promise<MediaTools>{
    const existing=await this.discover();if(existing){this.options.report?.(`기존 FFmpeg ${existing.version} 재사용 · ${existing.source} · ${existing.ffmpeg}`);return existing;}
    const controller=new AbortController(),context:DiscoveryContext={signal:controller.signal,incomplete:false,metadata:new Map()};
    setMaxListeners(0,context.signal);
    const timer=setTimeout(()=>controller.abort(new Error('영상 도구 준비 응답 시간이 초과되었습니다. 기존 설치는 유지됩니다. 저장 장치와 연결 상태를 확인한 뒤 다시 시도해 주세요.')),this.options.prepareTimeoutMs??600000);
    try{return await bounded(this.prepareMissing(spec,context),context.signal);}finally{clearTimeout(timer);}
  }
  private async prepareMissing(spec:MediaToolsSpec,context:DiscoveryContext):Promise<MediaTools>{
    const io=<T>(work:Promise<T>)=>bounded(work,context.signal,this.options.filesystemTimeoutMs??2000);
    const reason=this.lastReason;this.options.report?.(`${reason} 전용 영상 도구만 설치합니다.`,0);
    if(!/^https:\/\//i.test(spec.url)||!/^[a-f0-9]{64}$/i.test(spec.sha256))throw new Error('영상 도구 배포 정보가 올바르지 않습니다.');
    const folder=path.dirname(this.binDir);await io(fs.mkdir(folder,{recursive:true}));
    const archive=path.join(folder,'ffmpeg-download.zip');let bytes:Buffer|undefined,archiveSource:string|undefined;
    const archives=[archive,...(await this.candidates(context)).filter(item=>item.source==='cache').map(item=>path.join(path.dirname(path.dirname(item.ffmpeg)),'ffmpeg-download.zip'))];
    for(const cachedPath of new Set(archives)){
      const stat=await this.lookup(fs.stat(cachedPath),context);if(!stat||stat.size>300000000)continue;
      const cached=await this.lookup(fs.readFile(cachedPath),context);if(cached&&hash(cached)===spec.sha256.toLowerCase()){bytes=cached;archiveSource=cachedPath;break;}
    }
    if(archiveSource)this.options.report?.(`기존 FFmpeg 설치 파일 검증 완료 · 다운로드 없이 재사용 · ${archiveSource}`,.9);
    if(!bytes){
      // A cache/path lookup that timed out is not evidence that a fresh download is needed.
      if(context.incomplete)throw new MediaDiscoveryTimeoutError();
      const signal=AbortSignal.any([context.signal,AbortSignal.timeout(300000)]);
      const response=await bounded((this.options.fetch??fetch)(spec.url,{signal}),signal);
      if(!response.ok||!response.body)throw new Error(`FFmpeg 다운로드 실패: HTTP ${response.status}`);
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0,last=0;
      const expected=Number(response.headers.get('content-length'))||110000000;
      try{
        for(;;){const item=await bounded(reader.read(),signal);if(item.done)break;total+=item.value.length;if(total>300000000)throw new Error('FFmpeg 다운로드 크기 오류');chunks.push(item.value);if(Date.now()-last>250){last=Date.now();this.options.report?.(`전용 FFmpeg 다운로드 ${Math.round(total/1048576)} MB`,Math.min(1,total/expected));}}
      }catch(error){void reader.cancel().catch(()=>{});throw error;}
      bytes=Buffer.concat(chunks);if(hash(bytes)!==spec.sha256.toLowerCase())throw new Error('FFmpeg 무결성 검사 실패');
      await io(fs.writeFile(archive,bytes));
    }
    const files=unzipSync(bytes,{filter:entry=>/(?:^|\/)(?:ffmpeg\.exe|ffprobe\.exe|LICENSE|README\.txt)$/i.test(entry.name)});
    const staging=await io(fs.mkdtemp(path.join(folder,'ffmpeg-stage-')));
    try{
      const found=new Set<string>();
      for(const [name,data] of Object.entries(files)){
        const base=path.posix.basename(name.replaceAll('\\','/'));
        if(/^(ffmpeg|ffprobe)\.exe$/i.test(base)){if(found.has(base.toLowerCase()))throw new Error('중복된 FFmpeg 실행 파일');found.add(base.toLowerCase());await io(fs.writeFile(path.join(staging,base.toLowerCase()),data));}
        else await io(fs.writeFile(path.join(folder,base),data));
      }
      if(found.size!==2)throw new Error('FFmpeg 배포 파일에서 영상 도구를 찾지 못했습니다.');
      await this.validate(this.pair(staging,'download'),context);
      await io(fs.mkdir(this.binDir,{recursive:true}));
      for(const name of ['ffmpeg.exe','ffprobe.exe'])await io(fs.rename(path.join(staging,name),path.join(this.binDir,name)));
      const tools=await this.validate(this.pair(this.binDir,archiveSource?'cache':'download'),context);tools.reason=reason;
      try{await io(this.remember(tools));}catch{if(context.signal.aborted)throw context.signal.reason;}return tools;
    }finally{
      const relative=path.relative(folder,staging);
      if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)){
        // Cleanup must not turn a bounded failure back into an endless installation.
        try{await bounded(fs.rm(staging,{recursive:true,force:true}),new AbortController().signal,this.options.filesystemTimeoutMs??2000);}catch{/* A private staging directory can be retried/removed later. */}
      }
    }
  }
}
