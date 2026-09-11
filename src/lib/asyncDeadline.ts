/** A renderer deadline never treats a late IPC reply as the current result. */
export function withDeadline<T>(operation:Promise<T>, milliseconds:number, message:string, signal?:AbortSignal):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    let settled=false;
    const finish=(error:Error|null,value?:T)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(value as T);
    };
    const abort=()=>finish(new Error('이전 상태 확인을 중단했습니다.'));
    const timer=setTimeout(()=>finish(new Error(message)),milliseconds);
    operation.then(value=>finish(null,value),error=>finish(error instanceof Error?error:new Error(String(error))));
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
}
