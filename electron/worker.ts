import {spawn,ChildProcessWithoutNullStreams} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import type {ProgressEvent} from '../shared/contracts';
export interface PythonWorkerConfig {
  python:string;backend:string;bin?:string;models:string;logs:string;
  ffmpeg?:string;ffprobe?:string;daemonEntry?:string;
}
export interface WorkerRequestLimits {timeoutMs?:number;idleTimeoutMs?:number}
export function workerLaunchConfig(config:PythonWorkerConfig){
  const entry=config.daemonEntry?path.resolve(config.backend,config.daemonEntry):path.join(config.backend,'daemon.py');
  const ffmpeg=config.ffmpeg||(config.bin?path.join(config.bin,'ffmpeg.exe'):process.env.FFMPEG_PATH);
  const ffprobe=config.ffprobe||(config.bin?path.join(config.bin,'ffprobe.exe'):process.env.FFPROBE_PATH);
  if(!ffmpeg||!ffprobe||!path.isAbsolute(ffmpeg)||!path.isAbsolute(ffprobe))throw new Error('검증된 FFmpeg와 ffprobe의 절대 경로가 필요합니다.');
  return {entry,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',FFMPEG_PATH:ffmpeg,FFPROBE_PATH:ffprobe,DEPTHDESK_MODELS_DIR:config.models,HF_HOME:config.models,HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_SYMLINKS_WARNING:'1'}};
}
export class PythonWorker {
  private proc?:ChildProcessWithoutNullStreams;
  private pending=new Map<string,{resolve:(value:any)=>void,reject:(err:Error)=>void;touch:()=>void;dispose:()=>void}>();
  private tail='';
  private stopped=false;
  private stopping?:Promise<void>;
  constructor(private config:PythonWorkerConfig,private progress:(event:ProgressEvent)=>void){}
  get busy(){return this.pending.size>0;}
  get unusable(){return this.stopped;}
  private start(){
    if(this.stopped)throw new Error('AI 엔진이 중지되었습니다. 새 엔진으로 다시 시도해 주세요.');
    if(this.proc)return;
    fs.mkdirSync(this.config.logs,{recursive:true});
    const launch=workerLaunchConfig(this.config);
    const proc=spawn(this.config.python,['-u',launch.entry],{
      cwd:this.config.backend,windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:launch.env,
    });
    this.proc=proc;
    proc.stderr.on('data',chunk=>{this.tail=(this.tail+chunk.toString()).slice(-5000);try{fs.appendFileSync(path.join(this.config.logs,'engine.log'),chunk);}catch{/* A full log disk must not crash the IPC host. */}});
    readline.createInterface({input:proc.stdout}).on('line',line=>{
      try{const msg=JSON.parse(line);const request=this.pending.get(msg.id);if(!request)return;if(msg.type==='progress'){request.touch();this.progress({jobId:msg.id,...msg.data});return;}if(msg.type==='result'){request.dispose();this.pending.delete(msg.id);request.resolve(msg.data);}else if(msg.type==='error'){request.dispose();this.pending.delete(msg.id);request.reject(new Error(msg.error||'AI 처리 실패'));}}catch{this.tail=(this.tail+line).slice(-5000);}
    });
    const failed=(message:string)=>{if(this.proc!==proc)return;this.proc=undefined;for(const p of this.pending.values()){p.dispose();p.reject(new Error(message));}this.pending.clear();};
    proc.once('error',err=>failed(err.message));proc.once('exit',code=>failed(`AI 엔진이 종료되었습니다 (${code}). ${this.tail.slice(-1000)}`));
  }
  request<T=any>(id:string,command:string,payload:any,limits:WorkerRequestLimits={}):Promise<T>{
    if(this.pending.has(id))return Promise.reject(new Error('이미 진행 중인 요청 ID입니다.'));
    this.start();
    return new Promise<T>((resolve,reject)=>{
      let total:ReturnType<typeof setTimeout>|undefined,idle:ReturnType<typeof setTimeout>|undefined;
      const dispose=()=>{if(total)clearTimeout(total);if(idle)clearTimeout(idle);};
      const expire=()=>{
        if(!this.pending.has(id))return;
        const error=new Error('엔진 응답 시간이 초과되었습니다. 중단된 작업을 정리한 뒤 다시 시도해 주세요.');error.name='WorkerTimeoutError';
        dispose();this.pending.delete(id);reject(error);
        // A timed-out process may still own a cache/file lock. It cannot be reused.
        void this.stop().catch(error=>{this.tail=(this.tail+String(error)).slice(-5000);});
      };
      const touch=()=>{if(idle)clearTimeout(idle);if(limits.idleTimeoutMs)idle=setTimeout(expire,limits.idleTimeoutMs);};
      if(limits.timeoutMs)total=setTimeout(expire,limits.timeoutMs);
      this.pending.set(id,{resolve,reject,touch,dispose});touch();
      try{this.proc!.stdin.write(JSON.stringify({id,command,payload})+'\n',err=>{if(err){dispose();this.pending.delete(id);reject(err);}});}catch(error){dispose();this.pending.delete(id);reject(error);}
    });
  }
  stop(timeoutMs=5000):Promise<void>{
    if(this.stopping)return this.stopping;
    this.stopped=true;
    for(const p of this.pending.values()){p.dispose();p.reject(new Error('AI 엔진이 중지되었습니다.'));}
    this.pending.clear();
    const old=this.proc;
    if(!old)return Promise.resolve();
    // Await close, not just kill(): Windows keeps imported DLLs locked until exit.
    this.stopping=new Promise<void>((resolve,reject)=>{
      let settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);old.removeListener('close',closed);old.removeListener('error',failed);if(!error&&this.proc===old)this.proc=undefined;error?reject(error):resolve();};
      const closed=()=>finish();
      const failed=(error:Error)=>finish(new Error(`AI 엔진을 종료하지 못했습니다: ${error.message}`));
      const timer=setTimeout(()=>finish(new Error('AI 엔진 종료 시간이 초과되어 설치를 중단했습니다. 앱을 종료한 뒤 다시 시도해 주세요.')),timeoutMs);
      old.once('close',closed);old.once('error',failed);
      if(old.exitCode!==null||old.signalCode!==null)finish();
      else{try{old.kill();}catch(error){failed(error instanceof Error?error:new Error(String(error)));}}
    }).finally(()=>{this.stopping=undefined;});
    return this.stopping;
  }
}
