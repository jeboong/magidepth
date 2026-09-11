import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, ChildProcess} from 'node:child_process';
import {unzipSync} from 'fflate';
import type {RuntimeStatus} from '../shared/contracts';
import {MediaToolsResolver,type MediaTools,type MediaToolsSpec} from './media-tools';

async function extractSafe(archive:string,directory:string){
  const files=unzipSync(await fs.readFile(archive));
  for(const [name,bytes] of Object.entries(files)){
    const target=path.resolve(directory,name.replaceAll('\\','/')),relative=path.relative(directory,target);
    if(relative.startsWith('..')||path.isAbsolute(relative)||name.includes(':'))throw new Error('Unsafe archive entry');
    if(name.endsWith('/'))await fs.mkdir(target,{recursive:true});
    else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}
  }
}

interface RuntimeManifest {python:{version:string;sha256:string};pip:{sha256:string};torch:string;torchvision:string;cuda:string;ffmpeg:MediaToolsSpec}
interface Capabilities {python:string;versions:Record<string,string|null>;cloak:boolean;cloakError?:string}
interface RuntimeDependencies {
  media?:Pick<MediaToolsResolver,'discover'|'ensure'|'lastReason'>;
  runPython?:(args:string[],progress?:number)=>Promise<string>;
  extract?:(archive:string,directory:string)=>Promise<void>;
}
// Ignore user pip configuration (e.g. --user/target/index overrides) in our private runtime.
const pipArgs=['-m','pip','--isolated','install','--disable-pip-version-check','--no-input','--no-warn-script-location','--progress-bar','off'];
const FULL_IMPORTS='import torch, torchvision, transformers, cv2, numpy, PIL, easydict, einops, diffusers, accelerate, timm, kornia; assert hasattr(cv2,"FaceDetectorYN"); print("ENGINE_OK", torch.__version__)';

/** Python, depth dependencies, Cloak dependencies and media tools are independent repair stages. */
export class RuntimeManager {
  status:RuntimeStatus={ready:false,cloakReady:false,installing:false,progress:0,message:'MagiMagic 엔진과 설치된 영상 도구를 확인합니다.'};
  private current?:Promise<RuntimeStatus>;
  private currentScope?:'depth'|'cloak';
  private inspecting?:Promise<RuntimeStatus>;
  private inspectedAt=0;
  private inspectedFingerprint='';
  private child?:ChildProcess;
  private stopped=false;
  private resolvedMedia?:MediaTools;
  private resolver:Pick<MediaToolsResolver,'discover'|'ensure'|'lastReason'>;
  private verifiedDepthKey='';
  readonly runtimeDir:string;
  constructor(private userData:string,private resources:string,private backend:string,private emit:(state:RuntimeStatus)=>void,private devPython?:string,private dependencies:RuntimeDependencies={}){
    this.runtimeDir=path.join(userData,'engine','python-3.13-cu128-v1');
    this.resolver=dependencies.media??new MediaToolsResolver({userData,resources,report:(message,progress)=>this.report({message,progress:progress===undefined ? .86 : .85+.09*progress})});
  }
  get pythonPath(){return this.devPython||path.join(this.runtimeDir,'python.exe');}
  get modelsDir(){return path.join(this.userData,'models');}
  /** Legacy private location only. Consumers should pass mediaTools' distinct paths. */
  get binDir(){return path.join(this.userData,'tools','bin');}
  get mediaTools(){return this.resolvedMedia?{...this.resolvedMedia}:undefined;}
  private async requirements(){
    const contents=await fs.readFile(path.join(this.backend,'requirements.txt'),'utf8');
    const packages=Object.fromEntries(contents.split(/\r?\n/).map(line=>/^([a-zA-Z0-9_.-]+)==([^\s;#]+)/.exec(line.trim())).filter((match):match is RegExpExecArray=>!!match).map(match=>[match[1],match[2]]));
    return {hash:crypto.createHash('sha256').update(contents).digest('hex'),packages};
  }
  private report(next:Partial<RuntimeStatus>){this.status={...this.status,...next};this.emit({...this.status});}
  private async manifest():Promise<RuntimeManifest>{return JSON.parse(await fs.readFile(path.join(this.resources,'manifest.json'),'utf8'));}
  private check(){if(this.stopped)throw new Error('엔진 준비가 중지되었습니다. 다시 시도할 수 있습니다.');}
  private async capabilities(packages:Record<string,string>):Promise<Capabilities|undefined>{
    try{
      await fs.access(this.pythonPath);
      // Metadata avoids importing/loading Torch at all when only Cloak is requested.
      const names=[...new Set([...Object.keys(packages),'torch','torchvision','pip'])];
      const code=`import sys,json,importlib.metadata as m\nnames=${JSON.stringify(names)}\nversions={}\nfor name in names:\n try: versions[name]=m.version(name)\n except m.PackageNotFoundError: versions[name]=None\ncloak=False\nerror=''\ntry:\n import numpy,cv2\n cloak=hasattr(cv2,'FaceDetectorYN')\nexcept Exception as e: error=str(e)\nprint('MAGIMAGIC_RUNTIME_JSON:'+json.dumps(dict(python=sys.version.split()[0],versions=versions,cloak=cloak,cloakError=error)))`;
      const output=await this.execute(['-c',code]);
      const line=output.split(/\r?\n/).find(item=>item.startsWith('MAGIMAGIC_RUNTIME_JSON:'));
      if(!line)return undefined;const result=JSON.parse(line.slice('MAGIMAGIC_RUNTIME_JSON:'.length));
      if(typeof result.python!=='string'||!result.versions)return undefined;
      return result;
    }catch{return undefined;}
  }
  private torchMatches(caps:Capabilities|undefined,manifest:RuntimeManifest){
    return !!caps&&caps.versions.torch===`${manifest.torch}+${manifest.cuda}`&&caps.versions.torchvision===`${manifest.torchvision}+${manifest.cuda}`;
  }
  private depsMatch(caps:Capabilities|undefined,packages:Record<string,string>){return !!caps&&Object.entries(packages).every(([name,version])=>caps.versions[name]===version);}
  private async depthReady(caps:Capabilities|undefined,packages:Record<string,string>,manifest:RuntimeManifest){
    if(!caps?.cloak||!this.torchMatches(caps,manifest)||!this.depsMatch(caps,packages))return false;
    const key=JSON.stringify([this.pythonPath,caps.python,caps.versions]);
    if(this.verifiedDepthKey!==key){try{await this.execute(['-c',FULL_IMPORTS]);this.verifiedDepthKey=key;}catch{return false;}}
    return true;
  }
  private mediaMessage(tools:MediaTools){
    const labels={environment:'지정 경로',path:'시스템 PATH',cache:'기존 캐시',download:'전용 도구'};
    return `FFmpeg ${tools.version} · ${labels[tools.source]} 재사용 · ${tools.ffmpeg}${tools.reason?` · 참고: ${tools.reason}`:''}`;
  }
  private async fingerprint(){
    const files=[this.pythonPath,path.join(this.backend,'requirements.txt'),path.join(this.resources,'manifest.json'),...(this.resolvedMedia?[this.resolvedMedia.ffmpeg,this.resolvedMedia.ffprobe]:[])];
    return JSON.stringify(await Promise.all(files.map(async file=>{try{const stat=await fs.stat(file);return [file,stat.size,stat.mtimeMs];}catch{return [file,null];}})));
  }
  async inspect(force=false){
    if(this.current)return {...this.status};
    if(this.inspecting)return this.inspecting;
    // Preview/probe batches must not spawn Python once per file. Detect cheap on-disk
    // changes immediately and periodically recheck packages/environment (5-second TTL).
    if(!force&&Date.now()-this.inspectedAt<5000&&await this.fingerprint()===this.inspectedFingerprint)return {...this.status};
    if(this.inspecting)return this.inspecting;
    this.inspecting=this.inspectState().then(async state=>{this.inspectedFingerprint=await this.fingerprint();this.inspectedAt=Date.now();return state;}).finally(()=>{this.inspecting=undefined;});return this.inspecting;
  }
  private async inspectState(){
    try{
      const [manifest,requirements]=await Promise.all([this.manifest(),this.requirements()]);
      const [caps,tools]=await Promise.all([this.capabilities(requirements.packages),this.resolver.discover()]);
      this.resolvedMedia=tools;
      const ready=!!tools&&await this.depthReady(caps,requirements.packages,manifest),cloakReady=!!tools&&!!caps?.cloak;
      const message=ready?`MagiDepth · MagiCloak 준비 완료. ${this.mediaMessage(tools!)}`:cloakReady?`MagiCloak 준비 완료 · MagiDepth는 추가 엔진 설치가 필요합니다. ${this.mediaMessage(tools!)}`:!tools?`영상 도구 확인: ${this.resolver.lastReason} 필요한 도구만 준비합니다.`:caps?`필요한 엔진 구성만 추가합니다. ${this.mediaMessage(tools)}`:`MagiCloak은 경량 설치, MagiDepth는 AI 엔진 설치가 필요합니다. ${this.mediaMessage(tools)}`;
      this.report({ready,cloakReady,installing:false,error:undefined,progress:ready||cloakReady?1:0,message,pythonPath:caps?this.pythonPath:undefined,mediaTools:tools});
    }catch(error){this.report({ready:false,cloakReady:false,progress:0,message:'엔진 준비 상태를 확인하지 못했습니다.',error:error instanceof Error?error.message:String(error)});}
    return {...this.status};
  }
  install(){return this.installScope('depth');}
  installCloak(){return this.installScope('cloak');}
  private async installScope(scope:'depth'|'cloak'):Promise<RuntimeStatus>{
    if(this.current){const pendingScope=this.currentScope;await this.current;if(pendingScope===scope||pendingScope==='depth'||(scope==='depth'?this.status.ready:this.status.cloakReady))return {...this.status};}
    if(this.inspecting)await this.inspecting;
    // Revalidation discovers removed tools without triggering Python or Torch installation.
    await this.inspect(true);
    if(this.current)return this.installScope(scope);
    if(scope==='depth'?this.status.ready:this.status.cloakReady)return {...this.status};
    this.stopped=false;
    this.currentScope=scope;
    this.current=this.setup(scope).finally(()=>{this.current=undefined;this.currentScope=undefined;});return this.current;
  }
  private async ensurePython(manifest:RuntimeManifest,packages:Record<string,string>){
    let caps=await this.capabilities(packages);
    if(caps){this.report({progress:.08,message:`기존 Python ${caps.python} 재사용 · ${this.pythonPath}`});}
    else{
      if(this.devPython)throw new Error('지정한 개발용 Python을 실행할 수 없습니다. 전역 환경은 자동 변경하지 않습니다.');
      this.report({progress:.04,message:'앱 전용 경량 Python을 준비합니다. 기존 시스템 설치는 변경하지 않습니다.'});
      await fs.mkdir(this.runtimeDir,{recursive:true});
      await this.verifyResource('python-embed.zip',manifest.python.sha256);
      await (this.dependencies.extract??extractSafe)(path.join(this.resources,'python-embed.zip'),this.runtimeDir);
      await fs.mkdir(path.join(this.runtimeDir,'Lib','site-packages'),{recursive:true});
      await fs.writeFile(path.join(this.runtimeDir,'python313._pth'),'python313.zip\n.\nLib/site-packages\nimport site\n','utf8');
      caps=await this.capabilities(packages);
      if(!caps)throw new Error('전용 Python을 실행하지 못했습니다. 설치 파일과 디스크 상태를 확인해 주세요.');
    }
    if(!caps.versions.pip){
      if(this.devPython)throw new Error('개발용 Python에 pip가 없습니다. 전역 환경은 자동 변경하지 않습니다.');
      await this.verifyResource('pip.whl',manifest.pip.sha256);
      await (this.dependencies.extract??extractSafe)(path.join(this.resources,'pip.whl'),path.join(this.runtimeDir,'Lib','site-packages'));
    }
    return caps;
  }
  private async verifyResource(file:string,expected:string){
    const bytes=await fs.readFile(path.join(this.resources,file));
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('설치 리소스 무결성 오류. 설치 프로그램을 다시 내려받아 주세요.');
  }
  private async setup(scope:'depth'|'cloak'){
    try{
      this.report({installing:true,error:undefined,progress:.02,message:scope==='cloak'?'MagiCloak 경량 엔진을 확인합니다. PyTorch는 설치하지 않습니다.':'기존 엔진을 확인하고 필요한 구성만 준비합니다.'});
      const [manifest,requirements]=await Promise.all([this.manifest(),this.requirements()]);
      let caps:Capabilities|undefined=await this.ensurePython(manifest,requirements.packages);this.check();
      const minimal=Object.fromEntries(['numpy','opencv-python-headless'].map(name=>[name,requirements.packages[name]]));
      if(Object.values(minimal).some(version=>!version))throw new Error('경량 엔진 패키지 버전 정보가 없습니다.');
      if(scope==='depth'){
        if(!this.torchMatches(caps,manifest)){
          if(this.devPython)throw new Error('개발용 Python의 PyTorch/CUDA 버전이 맞지 않습니다. 전역 환경은 자동 변경하지 않습니다.');
          this.report({progress:.12,message:'MagiDepth에 필요한 PyTorch/CUDA를 준비합니다. 이미 충족된 패키지는 다시 받지 않습니다.'});
          await this.execute([...pipArgs,`torch==${manifest.torch}`,`torchvision==${manifest.torchvision}`,'--index-url',`https://download.pytorch.org/whl/${manifest.cuda}`],.12);this.check();
        }else this.report({progress:.66,message:'기존 PyTorch/CUDA 엔진 재사용 · 재설치/재다운로드 없음'});
        if(!this.depsMatch(caps,requirements.packages)){
          if(this.devPython)throw new Error('개발용 Python에 필수 라이브러리가 누락되었습니다. 전역 환경은 자동 변경하지 않습니다.');
          this.report({progress:.68,message:'변경되거나 누락된 AI 라이브러리만 설치합니다.'});
          await this.execute([...pipArgs,'-r',path.join(this.backend,'requirements.txt')],.68);this.check();
        }
      }else if(!caps.cloak||!this.depsMatch(caps,minimal)){
        if(this.devPython)throw new Error('개발용 Python에 numpy/OpenCV가 필요합니다. 전역 환경은 자동 변경하지 않습니다.');
        this.report({progress:.2,message:'경량 영상 처리 라이브러리만 설치합니다 · numpy + OpenCV, PyTorch 없음'});
        await this.execute([...pipArgs,...Object.entries(minimal).map(([name,version])=>`${name}==${version}`)],.2);this.check();
      }
      this.report({progress:.85,message:'설치된 FFmpeg와 ffprobe를 먼저 검증합니다.'});
      this.resolvedMedia=await this.resolver.ensure(manifest.ffmpeg);this.check();
      this.report({progress:.95,message:this.mediaMessage(this.resolvedMedia),mediaTools:this.mediaTools});
      caps=await this.capabilities(requirements.packages);this.check();
      if(!caps?.cloak)throw new Error(`경량 엔진 검증 실패: ${caps?.cloakError||'numpy/OpenCV FaceDetectorYN을 불러오지 못했습니다.'}`);
      const ready=await this.depthReady(caps,requirements.packages,manifest);this.check();
      if(scope==='depth'&&!ready)throw new Error('AI 엔진 필수 모듈 검증에 실패했습니다. 기존 패키지는 보존되며 다시 시도할 수 있습니다.');
      if(!this.devPython){
        // Cloak setup never replaces an existing depth ready marker.
        const marker=scope==='depth'?'ready.json':'cloak-ready.json';
        const data=scope==='depth'?{...manifest,schema:2,requirementsHash:requirements.hash}:{schema:1,packages:minimal};
        await fs.writeFile(path.join(this.runtimeDir,marker),JSON.stringify({...data,installedAt:new Date().toISOString()}));
      }
      this.report({ready,cloakReady:true,installing:false,progress:1,message:`${scope==='depth'?'MagiDepth · MagiCloak':'MagiCloak'} 준비 완료. ${this.mediaMessage(this.resolvedMedia)}`,pythonPath:this.pythonPath,mediaTools:this.mediaTools});
    }catch(error){this.report({installing:false,error:error instanceof Error?error.message:String(error),message:'필요한 엔진 구성 준비를 완료하지 못했습니다. 기존 설치는 유지됩니다. 오류를 확인하고 다시 시도해 주세요.'});}
    return {...this.status};
  }
  private execute(args:string[],progress?:number):Promise<string>{
    this.check();
    if(this.dependencies.runPython)return this.dependencies.runPython(args,progress);
    return new Promise((resolve,reject)=>{
      const proc=spawn(this.pythonPath,args,{windowsHide:true,cwd:path.dirname(this.pythonPath),env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PIP_DISABLE_PIP_VERSION_CHECK:'1'}});this.child=proc;
      let tail='',output='',settled=false;
      const timer=progress===undefined?setTimeout(()=>{proc.kill();finish(new Error('엔진 검증 응답 시간이 초과되었습니다.'));},60000):undefined;
      const finish=(error?:Error)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);if(this.child===proc)this.child=undefined;error?reject(error):resolve(output);};
      const consume=(chunk:Buffer)=>{const text=chunk.toString('utf8');tail=(tail+text).slice(-6000);if(progress!==undefined){const line=text.trim().split(/[\r\n]+/).filter(Boolean).at(-1);if(line)this.report({progress,message:line.slice(0,240)});}};
      proc.stdout.on('data',(chunk:Buffer)=>{output=(output+chunk.toString('utf8')).slice(-256000);consume(chunk);});proc.stderr.on('data',consume);
      proc.once('error',error=>finish(error));proc.once('close',code=>finish(code===0?undefined:new Error(`엔진 실행 단계 실패 (${code}). ${tail.slice(-1800)}`)));
    });
  }
  stop(){this.stopped=true;this.inspectedAt=0;this.child?.kill();}
}
