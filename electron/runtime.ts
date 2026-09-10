import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, ChildProcess} from 'node:child_process';
import {unzipSync} from 'fflate';
import type {RuntimeStatus} from '../shared/contracts';

async function extractSafe(archive:string,directory:string){
  const files=unzipSync(await fs.readFile(archive));
  for(const [name,bytes] of Object.entries(files)){
    const target=path.resolve(directory,name.replaceAll('\\','/'));
    const relative=path.relative(directory,target);
    if(relative.startsWith('..')||path.isAbsolute(relative)||name.includes(':'))throw new Error('Unsafe archive entry');
    if(name.endsWith('/'))await fs.mkdir(target,{recursive:true});
    else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}
  }
}

export class RuntimeManager {
  status: RuntimeStatus={ready:false,installing:false,progress:0,message:'AI 엔진 준비 상태를 확인합니다.'};
  private current?:Promise<RuntimeStatus>;
  private child?:ChildProcess;
  readonly runtimeDir:string;
  constructor(private userData:string,private resources:string,private backend:string,private emit:(state:RuntimeStatus)=>void,private devPython?:string){
    this.runtimeDir=path.join(userData,'engine','python-3.13-cu128-v1');
  }
  get pythonPath(){return this.devPython || path.join(this.runtimeDir,'python.exe');}
  get modelsDir(){return path.join(this.userData,'models');}
  get binDir(){return path.join(this.userData,'tools','bin');}
  private async requirementsHash(){return crypto.createHash('sha256').update(await fs.readFile(path.join(this.backend,'requirements.txt'))).digest('hex');}
  private report(next:Partial<RuntimeStatus>){this.status={...this.status,...next};this.emit({...this.status});}
  async inspect(){
    if(this.current) return this.status;
    try {
      if(this.devPython){await fs.access(this.devPython);this.report({ready:true,progress:1,message:'개발용 로컬 엔진',pythonPath:this.pythonPath});}
      else {const marker=JSON.parse(await fs.readFile(path.join(this.runtimeDir,'ready.json'),'utf8'));await fs.access(this.pythonPath);await fs.access(path.join(this.binDir,'ffmpeg.exe'));await fs.access(path.join(this.binDir,'ffprobe.exe'));if(marker.schema!==2||marker.requirementsHash!==await this.requirementsHash())throw new Error('Engine update required');this.report({ready:true,progress:1,message:'로컬 AI 엔진 준비 완료',pythonPath:this.pythonPath});}
    } catch {this.report({ready:false,progress:0,message:'첫 실행 시 전용 AI 엔진을 설치합니다. 인터넷과 기본 12 GB, 고급 AI 사용 시 25 GB 이상의 여유 공간을 권장합니다.'});}
    return {...this.status};
  }
  async install(){
    if(this.current)return this.current;
    if(this.status.ready)return this.status;
    this.current=this.setup().finally(()=>{this.current=undefined;});
    return this.current;
  }
  private async setup(){
    try{
      this.report({installing:true,ready:false,error:undefined,progress:.03,message:'전용 런타임을 준비합니다. 기존 Python 설치는 변경하지 않습니다.'});
      await fs.mkdir(this.runtimeDir,{recursive:true});
      const manifest=JSON.parse(await fs.readFile(path.join(this.resources,'manifest.json'),'utf8'));
      for(const [file,hash] of [['python-embed.zip',manifest.python.sha256],['pip.whl',manifest.pip.sha256]]){
        const bytes=await fs.readFile(path.join(this.resources,file));
        if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('설치 리소스의 무결성을 확인할 수 없습니다. 설치 프로그램을 다시 내려받아 주세요.');
      }
      await extractSafe(path.join(this.resources,'python-embed.zip'),this.runtimeDir);
      const site=path.join(this.runtimeDir,'Lib','site-packages');await fs.mkdir(site,{recursive:true});
      await extractSafe(path.join(this.resources,'pip.whl'),site);
      await fs.writeFile(path.join(this.runtimeDir,'python313._pth'),'python313.zip\n.\nLib/site-packages\nimport site\n','utf8');
      this.report({progress:.12,message:'RTX 50 시리즈용 PyTorch/CUDA 엔진 다운로드 · 네트워크에 따라 몇 분 걸릴 수 있습니다.'});
      await this.run(['-m','pip','install','--disable-pip-version-check','--no-input','--no-warn-script-location','--progress-bar','off','torch==2.7.1','torchvision==0.22.1','--index-url','https://download.pytorch.org/whl/cu128'],.12);
      this.report({progress:.68,message:'깊이 추정 라이브러리를 설치합니다.'});
      await this.run(['-m','pip','install','--disable-pip-version-check','--no-input','--no-warn-script-location','--progress-bar','off','-r',path.join(this.backend,'requirements.txt')],.68);
      this.report({progress:.85,message:'영상 도구 FFmpeg를 공식 배포처에서 다운로드합니다.'});
      await this.installMediaTools(manifest.ffmpeg);
      this.report({progress:.96,message:'엔진 실행과 필수 모듈을 검증합니다.'});
      await this.run(['-c','import torch, torchvision, transformers, cv2, numpy, PIL, easydict, einops, diffusers, accelerate, timm, kornia; print("ENGINE_OK", torch.__version__, torch.cuda.is_available())'],.96);
      await fs.writeFile(path.join(this.runtimeDir,'ready.json'),JSON.stringify({...manifest,schema:2,installedAt:new Date().toISOString(),requirementsHash:await this.requirementsHash()}));
      this.report({ready:true,installing:false,progress:1,message:'AI 엔진 준비 완료 · 모델은 최초 사용 시 자동 다운로드됩니다.',pythonPath:this.pythonPath});
    }catch(error){this.report({ready:false,installing:false,error:error instanceof Error?error.message:String(error),message:'엔진 설치를 완료하지 못했습니다. 네트워크와 저장 공간을 확인한 뒤 다시 시도하세요.'});}
    return {...this.status};
  }
  private async installMediaTools(spec:{url:string;sha256:string;version:string}){
    const folder=path.dirname(this.binDir);await fs.mkdir(folder,{recursive:true});
    const archive=path.join(folder,'ffmpeg-download.zip');let bytes:Buffer|undefined;
    try{const cached=await fs.readFile(archive);if(crypto.createHash('sha256').update(cached).digest('hex')===spec.sha256)bytes=cached;}catch{}
    if(!bytes){
      const response=await fetch(spec.url,{signal:AbortSignal.timeout(300000)});
      if(!response.ok)throw new Error(`FFmpeg 다운로드 실패: HTTP ${response.status}`);
      const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let total=0;let lastReport=0;const expected=Number(response.headers.get('content-length'))||110000000;
      for(;;){const item=await reader.read();if(item.done)break;chunks.push(item.value);total+=item.value.length;if(total>300000000)throw new Error('FFmpeg 다운로드 크기 오류');if(Date.now()-lastReport>250){lastReport=Date.now();this.report({progress:.85+.09*Math.min(1,total/expected),message:`FFmpeg 다운로드 ${Math.round(total/1048576)} MB`});}}
      bytes=Buffer.concat(chunks);if(crypto.createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error('FFmpeg 무결성 검사 실패');
      await fs.writeFile(archive,bytes);
    }
    const files=unzipSync(bytes,{filter:entry=>/\/(?:bin\/(?:ffmpeg|ffprobe)\.exe|LICENSE|README\.txt)$/i.test(entry.name)});
    await fs.mkdir(this.binDir,{recursive:true});let binaries=0;
    for(const [name,data] of Object.entries(files)){
      const base=path.basename(name);const exe=/^(ffmpeg|ffprobe)\.exe$/i.test(base);
      await fs.writeFile(path.join(exe?this.binDir:folder,base),data);if(exe)binaries++;
    }
    if(binaries!==2)throw new Error('FFmpeg 배포 파일에서 영상 도구를 찾지 못했습니다.');
  }
  private run(args:string[],progress:number){
    return new Promise<void>((resolve,reject)=>{
      const proc=spawn(this.pythonPath,args,{windowsHide:true,cwd:this.runtimeDir,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PIP_DISABLE_PIP_VERSION_CHECK:'1'}});this.child=proc;
      let tail='';
      const consume=(chunk:Buffer)=>{const text=chunk.toString('utf8');tail=(tail+text).slice(-6000);const line=text.trim().split(/[\r\n]+/).filter(Boolean).at(-1);if(line)this.report({progress,message:line.slice(0,240)});};
      proc.stdout.on('data',consume);proc.stderr.on('data',consume);
      proc.once('error',reject);proc.once('exit',code=>{this.child=undefined;code===0?resolve():reject(new Error(`엔진 설치 단계 실패 (${code}). ${tail.slice(-1800)}`));});
    });
  }
  stop(){this.child?.kill();}
}
