import {spawn,ChildProcessWithoutNullStreams} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import type {ProgressEvent} from '../shared/contracts';
export class PythonWorker {
  private proc?:ChildProcessWithoutNullStreams;
  private pending=new Map<string,{resolve:(value:any)=>void,reject:(err:Error)=>void}>();
  private tail='';
  constructor(private config:{python:string;backend:string;bin:string;models:string;logs:string},private progress:(event:ProgressEvent)=>void){}
  get busy(){return [...this.pending.keys()].some(x=>x.startsWith('preview-')||x.startsWith('render-'));}
  private start(){
    if(this.proc)return;
    fs.mkdirSync(this.config.logs,{recursive:true});
    const proc=spawn(this.config.python,['-u',path.join(this.config.backend,'daemon.py')],{
      cwd:this.config.backend,windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',FFMPEG_PATH:path.join(this.config.bin,'ffmpeg.exe'),FFPROBE_PATH:path.join(this.config.bin,'ffprobe.exe'),DEPTHDESK_MODELS_DIR:this.config.models,HF_HOME:this.config.models,HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_SYMLINKS_WARNING:'1'},
    });
    this.proc=proc;
    proc.stderr.on('data',chunk=>{this.tail=(this.tail+chunk.toString()).slice(-5000);fs.appendFileSync(path.join(this.config.logs,'engine.log'),chunk);});
    readline.createInterface({input:proc.stdout}).on('line',line=>{
      try{const msg=JSON.parse(line);if(msg.type==='progress'){this.progress({jobId:msg.id,...msg.data});return;}const request=this.pending.get(msg.id);if(!request)return;if(msg.type==='result'){request.resolve(msg.data);this.pending.delete(msg.id);}else if(msg.type==='error'){request.reject(new Error(msg.error||'AI 처리 실패'));this.pending.delete(msg.id);}}catch{this.tail=(this.tail+line).slice(-5000);}
    });
    const failed=(message:string)=>{if(this.proc!==proc)return;this.proc=undefined;for(const p of this.pending.values())p.reject(new Error(message));this.pending.clear();};
    proc.once('error',err=>failed(err.message));proc.once('exit',code=>failed(`AI 엔진이 종료되었습니다 (${code}). ${this.tail.slice(-1000)}`));
  }
  request<T=any>(id:string,command:string,payload:any):Promise<T>{
    this.start();
    return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.proc!.stdin.write(JSON.stringify({id,command,payload})+'\n',err=>{if(err){this.pending.delete(id);reject(err);}});});
  }
  stop(){for(const p of this.pending.values())p.reject(new Error('AI 엔진이 중지되었습니다.'));this.pending.clear();const old=this.proc;this.proc=undefined;old?.kill();}
}
