import {useCallback, useEffect, useRef, useState} from 'react';
import type {DepthOptions, MapKind} from '../../shared/contracts';
import {requiredModelIds, type DownloadModelId, type ModelCatalog, type ModelDownloadProgress} from '../../shared/model-catalog';
import {api} from './api';
import {errorMessage} from './utils';
import {withDeadline} from './asyncDeadline';

export const MODEL_CATALOG_TIMEOUT_MS=135_000;

export function useModelDownloads(engineReady:boolean, options:DepthOptions) {
  const [catalog,setCatalog]=useState<ModelCatalog|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [job,setJob]=useState<{id:string;modelId:DownloadModelId}|null>(null);
  const [progress,setProgress]=useState<ModelDownloadProgress|null>(null);
  const active=useRef<string|null>(null);
  const alive=useRef(true);
  const generation=useRef(0);
  const checking=useRef<AbortController|null>(null);
  const refresh=useCallback(async(clearError=true)=>{
    const token=++generation.current;
    checking.current?.abort();
    const controller=new AbortController();checking.current=controller;
    setLoading(true);if(clearError)setError('');
    try {
      const read=async()=>{
        while(!controller.signal.aborted){
          const value=await api.getModelCatalog();
          if(controller.signal.aborted)throw new Error('이전 확인을 중단했습니다.');
          if(!value.busy)return value;
          if(alive.current&&token===generation.current)setCatalog(value);
          // A reload can observe another in-flight job. Never keep that busy
          // snapshot forever after its originating request has completed.
          await withDeadline(new Promise<void>(resolve=>setTimeout(resolve,1000)),2000,'모델 상태를 다시 확인해 주세요.',controller.signal);
        }
        throw new Error('이전 확인을 중단했습니다.');
      };
      const value=await withDeadline(read(),MODEL_CATALOG_TIMEOUT_MS,'설치 상태 확인 시간이 초과되었습니다. 기존 모델은 유지됩니다. 잠시 후 ‘다시 확인’을 눌러 주세요.',controller.signal);
      if(alive.current&&token===generation.current)setCatalog(value);
    } catch(e) {if(alive.current&&token===generation.current){setCatalog(null);setError(errorMessage(e));}}
    finally {controller.abort();if(checking.current===controller)checking.current=null;if(alive.current&&token===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;
    const unsubscribe=api.onModelProgress?.(event=>{
      if(event.jobId===active.current)setProgress(event);
    });
    return()=>{alive.current=false;generation.current++;checking.current?.abort();unsubscribe?.();};
  },[]);
  useEffect(()=>{
    if(engineReady)void refresh();
    else {generation.current++;checking.current?.abort();setCatalog(null);setLoading(false);}
  },[engineReady,refresh]);
  const readyFor=useCallback((map:MapKind,next:DepthOptions=options)=>requiredModelIds(next,[map]).every(id=>catalog?.models.some(model=>model.id===id&&model.ready)),[catalog,options]);
  const missingFor=useCallback((map:MapKind)=>requiredModelIds(options,[map]).filter(id=>!catalog?.models.some(model=>model.id===id&&model.ready)),[catalog,options]);
  const download=useCallback(async(modelId:DownloadModelId)=>{
    if(active.current||!engineReady)return;
    const id=crypto.randomUUID();active.current=id;setJob({id,modelId});setProgress(null);setError('');
    generation.current++;
    checking.current?.abort();setLoading(false);
    try {
      const value=await api.downloadModel({jobId:id,modelId});
      if(alive.current)setCatalog(value);
    }catch(e){if(alive.current)setError(errorMessage(e));}
    finally{
      active.current=null;
      if(alive.current){setJob(null);setProgress(null);void refresh(false);}
    }
  },[engineReady,refresh]);
  const cancel=useCallback(async()=>{
    if(!active.current)return;
    try{await api.cancelModelDownload(active.current);}catch(e){setError(errorMessage(e));}
  },[]);
  return{catalog,loading,error,job,progress,refresh,readyFor,missingFor,download,cancel};
}
