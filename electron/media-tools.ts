import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {unzipSync} from 'fflate';

export interface MediaTools {
  ffmpeg:string; ffprobe:string; version:string; probeVersion:string;
  source:'environment'|'path'|'cache'|'download'; reason?:string;
}
export interface MediaToolsSpec {url:string;sha256:string;version:string}
export type CommandRunner=(file:string,args:string[],input?:Buffer)=>Promise<{stdout:Buffer;stderr:string}>;
export interface MediaToolsOptions {
  userData:string; resources?:string; env?:NodeJS.ProcessEnv; platform?:NodeJS.Platform;
  home?:string; legacyDirs?:string[]; run?:CommandRunner; fetch?:typeof fetch;
  report?:(message:string,progress?:number)=>void;
}

/** No shell: paths containing spaces or non-ASCII characters remain a single executable. */
export const runMediaCommand:CommandRunner=(file,args,input)=>new Promise((resolve,reject)=>{
  const child=spawn(file,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks:Buffer[]=[];let length=0,stderr='',finished=false;
  const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve({stdout:Buffer.concat(chunks),stderr});};
  const timer=setTimeout(()=>{child.kill();finish(new Error('영상 도구 응답 시간 초과'));},20000);
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
  lastReason='';
  constructor(private options:MediaToolsOptions){this.env=options.env??process.env;this.platform=options.platform??process.platform;this.run=options.run??runMediaCommand;}
  get binDir(){return path.join(this.options.userData,'tools','bin');}
  private get filename(){return this.platform==='win32'?{ffmpeg:'ffmpeg.exe',ffprobe:'ffprobe.exe'}:{ffmpeg:'ffmpeg',ffprobe:'ffprobe'};}
  private pair(dir:string,source:MediaTools['source']):Candidate{return {ffmpeg:path.join(dir,this.filename.ffmpeg),ffprobe:path.join(dir,this.filename.ffprobe),source};}
  private async isFile(file:string){try{return (await fs.stat(file)).isFile();}catch{return false;}}
  private async candidates(){
    const candidates:Candidate[]=[];
    const envValue=(key:string)=>Object.entries(this.env).find(([name])=>name.toLowerCase()===key.toLowerCase())?.[1];
    const pathDirs=(envValue('PATH')??'').split(this.platform==='win32'?';':':').map(trimPath).filter(dir=>dir&&path.isAbsolute(dir));
    const pathPairs=pathDirs.map(dir=>this.pair(dir,'path'));
    // Enumerate individual tools too: FFmpeg and ffprobe need not share a folder.
    const pathFFmpeg:string[]=[],pathFFprobe:string[]=[];
    for(const pair of pathPairs){if(await this.isFile(pair.ffmpeg))pathFFmpeg.push(pair.ffmpeg);if(await this.isFile(pair.ffprobe))pathFFprobe.push(pair.ffprobe);}
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
    try{const saved=JSON.parse(await fs.readFile(path.join(this.options.userData,'tools','resolved.json'),'utf8'));if(typeof saved.ffmpeg==='string'&&typeof saved.ffprobe==='string')candidates.push({ffmpeg:saved.ffmpeg,ffprobe:saved.ffprobe,source:'cache'});}catch{}
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
        try{for(const entry of await fs.readdir(packages,{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('Gyan.FFmpeg_')){
          const pkg=path.join(packages,entry.name);
          for(const version of await fs.readdir(pkg,{withFileTypes:true}))if(version.isDirectory()&&version.name.startsWith('ffmpeg-'))cacheDirs.push(path.join(pkg,version.name,'bin'));
        }}catch{}
      }
      const programFiles=envValue('ProgramFiles');if(programFiles)cacheDirs.push(path.join(programFiles,'ffmpeg','bin'));
    }
    for(const dir of cacheDirs)candidates.push(this.pair(dir,'cache'));
    const seen=new Set<string>();
    return candidates.filter(candidate=>{const key=`${candidate.ffmpeg}\0${candidate.ffprobe}`.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  }
  async validate(candidate:Candidate):Promise<MediaTools>{
    const {ffmpeg,ffprobe}=candidate;
    if(!path.isAbsolute(ffmpeg)||!path.isAbsolute(ffprobe)||ffmpeg.includes('\0')||ffprobe.includes('\0'))throw new Error('영상 도구는 절대 경로여야 합니다.');
    // Windows scripts are not executables and must never be launched through a shell.
    if(this.platform==='win32'&&(!/\.exe$/i.test(ffmpeg)||!/\.exe$/i.test(ffprobe)))throw new Error('영상 도구는 .exe 파일이어야 합니다.');
    const [ffStat,probeStat]=await Promise.all([fs.stat(ffmpeg),fs.stat(ffprobe)]);
    if(!ffStat.isFile()||!probeStat.isFile())throw new Error('FFmpeg 또는 ffprobe가 파일이 아닙니다.');
    const key=`${ffmpeg}\0${ffprobe}`,fingerprint=[ffStat.size,ffStat.mtimeMs,probeStat.size,probeStat.mtimeMs].join(':');
    const cached=this.verified.get(key);if(cached?.fingerprint===fingerprint)return {...cached.tools,source:candidate.source};
    const [ff,probe,encoders]=await Promise.all([this.run(ffmpeg,['-hide_banner','-version']),this.run(ffprobe,['-hide_banner','-version']),this.run(ffmpeg,['-hide_banner','-encoders'])]);
    const version=/^ffmpeg version\s+(\S+)/m.exec(ff.stdout.toString())?.[1];
    const probeVersion=/^ffprobe version\s+(\S+)/m.exec(probe.stdout.toString())?.[1];
    if(!version||!probeVersion)throw new Error('FFmpeg/ffprobe 버전 응답을 확인하지 못했습니다.');
    if(!/\blibx264\b/.test(encoders.stdout.toString())||!/\blibx265\b/.test(encoders.stdout.toString()))throw new Error('H.264(libx264) 또는 HEVC(libx265) 인코더가 없습니다.');
    // Exercise the actual raw-frame, fps_mode, MP4 export and JSON probing workflow.
    const encoded=await this.run(ffmpeg,['-hide_banner','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size','64x64','-framerate','1','-i','pipe:0','-frames:v','1','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-fps_mode','passthrough','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],Buffer.alloc(64*64*3,128));
    const result=await this.run(ffprobe,['-v','error','-show_entries','stream=codec_name,width,height','-of','json','pipe:0'],encoded.stdout);
    const stream=JSON.parse(result.stdout.toString()).streams?.[0];
    if(stream?.codec_name!=='h264'||stream.width!==64||stream.height!==64)throw new Error('FFmpeg 시험 인코딩 또는 ffprobe 분석 검증에 실패했습니다.');
    const tools:MediaTools={...candidate,version,probeVersion};this.verified.set(key,{fingerprint,tools});return tools;
  }
  private async remember(tools:MediaTools){try{await fs.mkdir(path.dirname(this.binDir),{recursive:true});await fs.writeFile(path.join(path.dirname(this.binDir),'resolved.json'),JSON.stringify(tools,null,2));}catch{/* Read-only cache is not a reason to reject working system tools. */}}
  async discover():Promise<MediaTools|undefined>{
    this.lastReason='';const failures:string[]=[];
    for(const candidate of await this.candidates()){
      // Missing legacy folders are normal; explicit override failures are worth reporting.
      if(!await this.isFile(candidate.ffmpeg)||!await this.isFile(candidate.ffprobe)){
        if(candidate.source==='environment')failures.push('환경 변수의 FFmpeg/ffprobe 경로가 없거나 짝이 누락되었습니다.');continue;
      }
      try{const tools=await this.validate(candidate);if(failures.length)tools.reason=failures.join(' ').slice(0,1200);await this.remember(tools);return tools;}
      catch(error){failures.push(`${candidate.source}: ${candidate.ffmpeg}: ${error instanceof Error?error.message:String(error)}`);}
    }
    this.lastReason=failures.join(' ').slice(0,1800)||this.lastReason||'사용 가능한 FFmpeg와 ffprobe를 환경 변수, PATH, 기존 캐시에서 찾지 못했습니다.';return undefined;
  }
  async ensure(spec:MediaToolsSpec):Promise<MediaTools>{
    const existing=await this.discover();if(existing){this.options.report?.(`기존 FFmpeg ${existing.version} 재사용 · ${existing.source} · ${existing.ffmpeg}`);return existing;}
    const reason=this.lastReason;this.options.report?.(`${reason} 전용 영상 도구만 설치합니다.`,0);
    if(!/^https:\/\//i.test(spec.url)||!/^[a-f0-9]{64}$/i.test(spec.sha256))throw new Error('영상 도구 배포 정보가 올바르지 않습니다.');
    const folder=path.dirname(this.binDir);await fs.mkdir(folder,{recursive:true});
    const archive=path.join(folder,'ffmpeg-download.zip');let bytes:Buffer|undefined,archiveSource:string|undefined;
    const archives=[archive,...(await this.candidates()).filter(item=>item.source==='cache').map(item=>path.join(path.dirname(path.dirname(item.ffmpeg)),'ffmpeg-download.zip'))];
    for(const cachedPath of new Set(archives)){
      try{if((await fs.stat(cachedPath)).size>300000000)continue;const cached=await fs.readFile(cachedPath);if(hash(cached)===spec.sha256.toLowerCase()){bytes=cached;archiveSource=cachedPath;break;}}catch{}
    }
    if(archiveSource)this.options.report?.(`기존 FFmpeg 설치 파일 검증 완료 · 다운로드 없이 재사용 · ${archiveSource}`,.9);
    if(!bytes){
      const response=await (this.options.fetch??fetch)(spec.url,{signal:AbortSignal.timeout(300000)});
      if(!response.ok||!response.body)throw new Error(`FFmpeg 다운로드 실패: HTTP ${response.status}`);
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0,last=0;
      const expected=Number(response.headers.get('content-length'))||110000000;
      for(;;){const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>300000000){await reader.cancel();throw new Error('FFmpeg 다운로드 크기 오류');}chunks.push(item.value);if(Date.now()-last>250){last=Date.now();this.options.report?.(`전용 FFmpeg 다운로드 ${Math.round(total/1048576)} MB`,Math.min(1,total/expected));}}
      bytes=Buffer.concat(chunks);if(hash(bytes)!==spec.sha256.toLowerCase())throw new Error('FFmpeg 무결성 검사 실패');
      await fs.writeFile(archive,bytes);
    }
    const files=unzipSync(bytes,{filter:entry=>/(?:^|\/)(?:ffmpeg\.exe|ffprobe\.exe|LICENSE|README\.txt)$/i.test(entry.name)});
    const staging=await fs.mkdtemp(path.join(folder,'ffmpeg-stage-'));
    try{
      const found=new Set<string>();
      for(const [name,data] of Object.entries(files)){
        const base=path.posix.basename(name.replaceAll('\\','/'));
        if(/^(ffmpeg|ffprobe)\.exe$/i.test(base)){if(found.has(base.toLowerCase()))throw new Error('중복된 FFmpeg 실행 파일');found.add(base.toLowerCase());await fs.writeFile(path.join(staging,base.toLowerCase()),data);}
        else await fs.writeFile(path.join(folder,base),data);
      }
      if(found.size!==2)throw new Error('FFmpeg 배포 파일에서 영상 도구를 찾지 못했습니다.');
      await this.validate(this.pair(staging,'download'));
      await fs.mkdir(this.binDir,{recursive:true});
      for(const name of ['ffmpeg.exe','ffprobe.exe'])await fs.rename(path.join(staging,name),path.join(this.binDir,name));
      const tools=await this.validate(this.pair(this.binDir,archiveSource?'cache':'download'));tools.reason=reason;await this.remember(tools);return tools;
    }finally{
      const relative=path.relative(folder,staging);
      if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))await fs.rm(staging,{recursive:true,force:true});
    }
  }
}
