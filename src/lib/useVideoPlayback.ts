import {useCallback,useEffect,useRef,useState} from 'react';
import type {ProgressEvent,VideoInfo} from '../../shared/contracts';
import {api,isBrowserDemo,mediaUrl} from './api';
import {errorMessage} from './utils';

/** Playback-only proxy. Export and AI preview must always use VideoInfo.path. */
export function useVideoPlayback(video:VideoInfo|null,blocked:boolean){
  const [proxyPath,setProxyPath]=useState('');
  const [phase,setPhase]=useState<'native'|'waiting'|'preparing'|'proxy'|'error'>('native');
  const [error,setError]=useState('');
  const [progress,setProgress]=useState<ProgressEvent|null>(null);
  const job=useRef<string|null>(null);
  const revision=useRef(0);
  const cancelled=useRef(false);
  useEffect(()=>{
    const token=++revision.current;
    const previous=job.current;job.current=null;
    if(previous)void api.cancelPlayback(previous).catch(()=>{});
    setProxyPath('');setPhase('native');setError('');setProgress(null);cancelled.current=false;
    return()=>{if(token===revision.current)revision.current++;const id=job.current;job.current=null;if(id)void api.cancelPlayback(id).catch(()=>{});};
  },[video?.path]);
  useEffect(()=>api.onPlaybackProgress?.(event=>{if(event.jobId===job.current)setProgress(event);}),[]);
  const prepare=useCallback(async()=>{
    if(!video||video.kind==='image'||job.current)return;
    if(isBrowserDemo){setPhase('error');setError('이 코덱은 브라우저에서 재생할 수 없습니다. 데스크톱 앱에서는 호환 미리보기를 만들 수 있습니다.');return;}
    if(blocked){setPhase('waiting');return;}
    const token=revision.current;
    const id=crypto.randomUUID();job.current=id;cancelled.current=false;
    setPhase('preparing');setProgress(null);setError('');
    try{
      const result=await api.preparePlayback({jobId:id,path:video.path});
      if(token!==revision.current)return;
      if(cancelled.current){setError('호환 미리보기 준비를 취소했습니다.');setPhase('error');return;}
      setProxyPath(result.path);setPhase('proxy');
    }catch(e){if(token===revision.current){setError(cancelled.current?'호환 미리보기 준비를 취소했습니다.':errorMessage(e));setPhase('error');}}
    finally{if(job.current===id)job.current=null;}
  },[video,blocked]);
  useEffect(()=>{if(phase==='waiting'&&!blocked)void prepare();},[phase,blocked,prepare]);
  const mediaError=useCallback(()=>{
    if(proxyPath){setError('호환 미리보기를 재생하지 못했습니다. 다시 준비하거나 프레임 미리보기를 이용해 주세요.');setPhase('error');}
    else if(phase==='native')void prepare();
  },[proxyPath,phase,prepare]);
  const cancel=useCallback(async()=>{
    const id=job.current;if(!id)return;cancelled.current=true;
    try{await api.cancelPlayback(id);}catch(e){setError(errorMessage(e));}
  },[]);
  return{sourceUrl:video?mediaUrl(proxyPath||video.path):'',phase,error,progress,busy:phase==='preparing',prepare,mediaError,cancel};
}
