import {useCallback, useEffect, useRef, useState} from 'react';
import type {DepthOptions, MapKind} from '../../shared/contracts';
import {requiredModelIds, type DownloadModelId, type ModelCatalog, type ModelDownloadProgress} from '../../shared/model-catalog';
import {api} from './api';
import {errorMessage} from './utils';

export function useModelDownloads(engineReady:boolean, options:DepthOptions) {
  const [catalog,setCatalog]=useState<ModelCatalog|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [job,setJob]=useState<{id:string;modelId:DownloadModelId}|null>(null);
  const [progress,setProgress]=useState<ModelDownloadProgress|null>(null);
  const active=useRef<string|null>(null);
  const alive=useRef(true);
  const generation=useRef(0);
  const refresh=useCallback(async(clearError=true)=>{
    const token=++generation.current;
    setLoading(true);if(clearError)setError('');
    try {
      const value=await api.getModelCatalog();
      if(alive.current&&token===generation.current)setCatalog(value);
    } catch(e) {if(alive.current&&token===generation.current)setError(errorMessage(e));}
    finally {if(alive.current&&token===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;
    const unsubscribe=api.onModelProgress?.(event=>{
      if(event.jobId===active.current)setProgress(event);
    });
    return()=>{alive.current=false;generation.current++;unsubscribe?.();};
  },[]);
  useEffect(()=>{
    if(engineReady)void refresh();
    else {generation.current++;setCatalog(null);setLoading(false);}
  },[engineReady,refresh]);
  const readyFor=useCallback((map:MapKind,next:DepthOptions=options)=>requiredModelIds(next,[map]).every(id=>catalog?.models.some(model=>model.id===id&&model.ready)),[catalog,options]);
  const missingFor=useCallback((map:MapKind)=>requiredModelIds(options,[map]).filter(id=>!catalog?.models.some(model=>model.id===id&&model.ready)),[catalog,options]);
  const download=useCallback(async(modelId:DownloadModelId)=>{
    if(active.current||!engineReady)return;
    const id=crypto.randomUUID();active.current=id;setJob({id,modelId});setProgress(null);setError('');
    generation.current++;
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
