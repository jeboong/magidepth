import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {Check,Film,RotateCcw,Scissors,X} from 'lucide-react';
import {Button} from './ui/button';
import {exportVideoTrim,formatVideoTrimTime,moveVideoTrim,normalizeVideoTrim,trimBoundaryTime,trimPreviewTime,trimTimeBoundary,videoTrimBounds,type VideoTrimEdge,type VideoTrimFrames,type VideoTrimRange} from './videoTrim';
import './VideoTrimEditor.css';

export interface VideoTrimEditorProps {
  sourceUrl:string;
  duration:number;
  fps:number;
  currentTime:number;
  value:VideoTrimRange|null;
  disabled?:boolean;
  onSeek:(seconds:number)=>void;
  onApply:(range:VideoTrimRange|null)=>void;
  onEditingChange?:(editing:boolean)=>void;
}
interface DragState {pointerId:number;edge:VideoTrimEdge;target:HTMLButtonElement;left:number;width:number;offset:number;initial:VideoTrimFrames;clientX:number}
type ThumbnailState='loading'|'ready'|'unavailable';
function waitForVideo(video:HTMLVideoElement,event:string,signal:AbortSignal,ready:()=>boolean,timeout=7000):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
    if(ready()){resolve();return;}
    const done=(error?:Error)=>{clearTimeout(timer);video.removeEventListener(event,complete);video.removeEventListener('error',failed);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const complete=()=>done(),failed=()=>done(new Error('Video preview unavailable')),abort=()=>done(new DOMException('Cancelled','AbortError'));
    const timer=window.setTimeout(()=>done(new Error('Video preview timed out')),timeout);
    video.addEventListener(event,complete,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',abort,{once:true});
  });
}

function TrimTimeInput({label,value,max,step,disabled,onCommit}:{label:string;value:number;max:number;step:number;disabled:boolean;onCommit:(value:number)=>void}){
  const [text,setText]=useState(value.toFixed(3));
  useEffect(()=>setText(value.toFixed(3)),[value]);
  const commit=()=>{const next=Number(text);setText(value.toFixed(3));if(text.trim()!==''&&Number.isFinite(next))onCommit(next);};
  return <label className="video-trim-time-field"><span>{label}</span><input type="number" min={0} max={max} step={step} value={text} disabled={disabled} aria-label={`자르기 ${label} 초`} onChange={event=>setText(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}if(event.key!=='Escape')event.stopPropagation();}}/><small>초</small></label>;
}

export function VideoTrimEditor({sourceUrl,duration,fps,currentTime,value,disabled=false,onSeek,onApply,onEditingChange}:VideoTrimEditorProps){
  const bounds=useMemo(()=>videoTrimBounds(duration,fps),[duration,fps]);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState<VideoTrimFrames>(()=>normalizeVideoTrim(value,bounds));
  const [thumbnails,setThumbnails]=useState<string[]>([]);
  const [thumbnailState,setThumbnailState]=useState<ThumbnailState>('loading');
  const [dragging,setDragging]=useState<VideoTrimEdge|null>(null);
  const draftRef=useRef(draft),drag=useRef<DragState|null>(null),animation=useRef<number|null>(null),track=useRef<HTMLDivElement>(null),openButton=useRef<HTMLButtonElement>(null),startHandle=useRef<HTMLButtonElement>(null);
  const seekRef=useRef(onSeek),boundsRef=useRef(bounds),hint=useId();
  const editingCallback=useRef(onEditingChange);editingCallback.current=onEditingChange;
  // Synchronize playback bounds before the newly opened/closed editor can be used.
  useLayoutEffect(()=>{editingCallback.current?.(editing);},[editing]);
  draftRef.current=draft;seekRef.current=onSeek;boundsRef.current=bounds;
  const usable=!!sourceUrl&&bounds.frames>0&&!disabled;
  const updateDraft=(next:VideoTrimFrames)=>{draftRef.current=next;setDraft(next);};
  const clearDrag=(restore=false)=>{
    if(animation.current!==null){cancelAnimationFrame(animation.current);animation.current=null;}
    const previous=drag.current;drag.current=null;setDragging(null);
    if(previous){if(restore)updateDraft(previous.initial);if(previous.target.hasPointerCapture(previous.pointerId))previous.target.releasePointerCapture(previous.pointerId);}
  };
  useEffect(()=>{
    clearDrag();setEditing(false);updateDraft(normalizeVideoTrim(value,bounds));setThumbnails([]);
    // A different source discards local edits without changing the applied range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sourceUrl,duration,fps]);
  useEffect(()=>{if(!editing)updateDraft(normalizeVideoTrim(value,bounds));},[value?.start,value?.end,editing,bounds]);
  useEffect(()=>{if(disabled)clearDrag(true);},[disabled]);
  useEffect(()=>()=>{if(animation.current!==null)cancelAnimationFrame(animation.current);drag.current=null;},[]);
  useEffect(()=>{
    if(!editing||!sourceUrl||!bounds.frames)return;
    const controller=new AbortController(),video=document.createElement('video');
    let alive=true;
    video.muted=true;video.playsInline=true;video.preload='auto';video.disableRemotePlayback=true;
    setThumbnailState('loading');setThumbnails([]);
    const load=async()=>{
      try{
        const metadata=waitForVideo(video,'loadedmetadata',controller.signal,()=>video.readyState>=1);
        video.src=sourceUrl;video.load();await metadata;
        await waitForVideo(video,'loadeddata',controller.signal,()=>video.readyState>=2);
        const canvas=document.createElement('canvas');canvas.width=128;canvas.height=80;
        const context=canvas.getContext('2d');if(!context||!video.videoWidth||!video.videoHeight)throw new Error('Video dimensions unavailable');
        const images:string[]=[];
        for(let index=0;index<12;index++){
          const time=Math.min(Math.max(0,bounds.duration-1/bounds.fps),bounds.duration*(index+.5)/12);
          if(Math.abs(video.currentTime-time)>.0005){const sought=waitForVideo(video,'seeked',controller.signal,()=>false);video.currentTime=time;await sought;}
          if(!alive||controller.signal.aborted)return;
          const scale=Math.max(canvas.width/video.videoWidth,canvas.height/video.videoHeight),width=video.videoWidth*scale,height=video.videoHeight*scale;
          context.fillStyle='#17191d';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(video,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
          images.push(canvas.toDataURL('image/jpeg',.65));setThumbnails([...images]);
        }
        if(alive)setThumbnailState('ready');
      }catch{if(alive&&!controller.signal.aborted)setThumbnailState('unavailable');}
    };
    void load();
    return()=>{alive=false;controller.abort();video.pause();video.removeAttribute('src');video.load();};
  },[editing,sourceUrl,bounds]);
  const focusedOnce=useRef(false);
  useLayoutEffect(()=>{
    if(editing)startHandle.current?.focus();
    else if(focusedOnce.current)openButton.current?.focus();
    focusedOnce.current=true;
  },[editing]);

  const preview=(range:VideoTrimFrames,edge:VideoTrimEdge)=>seekRef.current(trimPreviewTime(range,edge,boundsRef.current));
  const move=(edge:VideoTrimEdge,frame:number,seek=true)=>{const next=moveVideoTrim(draftRef.current,edge,frame,bounds);updateDraft(next);if(seek)preview(next,edge);};
  const flushDrag=()=>{
    animation.current=null;const current=drag.current;if(!current||disabled)return;
    const frame=(current.clientX-current.left-current.offset)/current.width*bounds.frames;
    const next=moveVideoTrim(draftRef.current,current.edge,frame,bounds);
    if(next.start!==draftRef.current.start||next.end!==draftRef.current.end){updateDraft(next);preview(next,current.edge);}
  };
  const startDrag=(event:PointerEvent<HTMLButtonElement>,edge:VideoTrimEdge)=>{
    if(!usable||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus();
    const rect=track.current?.getBoundingClientRect();if(!rect?.width)return;
    clearDrag();event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={pointerId:event.pointerId,edge,target:event.currentTarget,left:rect.left,width:rect.width,offset:event.clientX-rect.left-draftRef.current[edge]/bounds.frames*rect.width,initial:{...draftRef.current},clientX:event.clientX};setDragging(edge);
  };
  const dragMove=(event:PointerEvent<HTMLButtonElement>)=>{if(drag.current?.pointerId!==event.pointerId)return;drag.current.clientX=event.clientX;if(animation.current===null)animation.current=requestAnimationFrame(flushDrag);};
  const stopDrag=(event:PointerEvent<HTMLButtonElement>,cancel=false)=>{if(drag.current?.pointerId!==event.pointerId)return;if(!cancel){drag.current.clientX=event.clientX;if(animation.current!==null)cancelAnimationFrame(animation.current);flushDrag();}clearDrag(cancel);};
  const handleKeys=(event:KeyboardEvent<HTMLButtonElement>,edge:VideoTrimEdge)=>{
    if(!usable)return;
    let frame=draftRef.current[edge];
    if(event.key==='ArrowLeft'||event.key==='ArrowDown')frame-=event.shiftKey?10:1;
    else if(event.key==='ArrowRight'||event.key==='ArrowUp')frame+=event.shiftKey?10:1;
    else if(event.key==='PageDown')frame-=Math.max(1,Math.round(bounds.fps));
    else if(event.key==='PageUp')frame+=Math.max(1,Math.round(bounds.fps));
    else if(event.key==='Home')frame=edge==='start'?0:draftRef.current.start+1;
    else if(event.key==='End')frame=edge==='end'?bounds.frames:draftRef.current.end-1;
    else return;
    event.preventDefault();event.stopPropagation();move(edge,frame);
  };
  const close=()=>{clearDrag();setEditing(false);};
  const cancel=()=>{updateDraft(normalizeVideoTrim(value,bounds));close();};
  const start=trimBoundaryTime(draft.start,bounds),end=trimBoundaryTime(draft.end,bounds);
  const left=bounds.frames?draft.start/bounds.frames*100:0,right=bounds.frames?draft.end/bounds.frames*100:100;
  const playhead=bounds.duration?Math.max(0,Math.min(100,(Number.isFinite(currentTime)?currentTime:0)/bounds.duration*100)):0;
  const applied=normalizeVideoTrim(value,bounds),hasTrim=value!==null&&(applied.start>0||applied.end<bounds.frames);

  if(!editing)return <div className="video-trim-collapsed" data-applied={hasTrim||undefined}>
    {hasTrim&&<div className="video-trim-applied" role="status" data-testid="video-trim-applied"><Check size={14}/><span>자르기 적용<small>원본 {formatVideoTrimTime(trimBoundaryTime(applied.start,bounds))} — {formatVideoTrimTime(trimBoundaryTime(applied.end,bounds))} · 선택 구간만 재생</small></span></div>}
    <div className="video-trim-collapsed-actions">
      {hasTrim&&<Button variant="ghost" size="sm" disabled={!usable} onClick={()=>onApply(null)} data-testid="video-trim-clear" aria-label="전체 영상 복원" title="자르기를 해제하고 전체 영상을 재생합니다"><RotateCcw/></Button>}
      <Button ref={openButton} variant={hasTrim?'secondary':'ghost'} size="sm" disabled={!usable} onClick={()=>{updateDraft(normalizeVideoTrim(value,bounds));setEditing(true);}} title={hasTrim?'원본 전체에서 구간을 다시 선택합니다':'필요한 경우에만 재생·내보낼 구간을 자르세요'} data-testid="video-trim-open"><Scissors/>{hasTrim?'자르기 수정':'자르기'}</Button>
    </div>
  </div>;
  return <section className="video-trim-editor" aria-label="동영상 자르기 편집" data-video-trim-editor data-testid="video-trim-editor" data-thumbnail-state={thumbnailState} data-dragging={dragging??undefined} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}}}>
    <div className="video-trim-heading"><span><Scissors size={13}/>동영상 자르기</span><output aria-live={dragging?'off':'polite'}>{formatVideoTrimTime(Math.max(0,end-start))}<small> · {draft.end-draft.start}프레임</small></output></div>
    <div className="video-trim-filmstrip-wrap"><div ref={track} className="video-trim-filmstrip" onPointerDown={event=>{if(!usable||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();const seconds=(event.clientX-rect.left)/rect.width*bounds.duration;onSeek(Math.max(0,Math.min(bounds.duration-1/bounds.fps,seconds)));}}>
      <div className="video-trim-thumbnails" aria-hidden="true">{Array.from({length:12},(_,index)=><div key={index}>{thumbnails[index]?<img src={thumbnails[index]} alt="" draggable={false}/>:<Film size={13}/>}</div>)}</div>
      {thumbnailState==='unavailable'&&!thumbnails.length&&<span className="video-trim-thumbnail-note">썸네일 없이 구간을 선택할 수 있어요</span>}
      <div className="video-trim-outside video-trim-outside-left" style={{width:`${left}%`}}/><div className="video-trim-outside video-trim-outside-right" style={{width:`${100-right}%`}}/>
      <div className="video-trim-selection" style={{left:`${left}%`,width:`${right-left}%`}}/>
      <div className="video-trim-playhead" style={{left:`${playhead}%`}} aria-hidden="true"/>
      {(['start','end'] as const).map(edge=><button key={edge} ref={edge==='start'?startHandle:undefined} type="button" role="slider" className={`video-trim-handle video-trim-handle-${edge}`} style={{left:`${edge==='start'?left:right}%`}} aria-label={edge==='start'?'자르기 시작 지점':'자르기 종료 지점'} aria-orientation="horizontal" aria-valuemin={edge==='start'?0:trimBoundaryTime(draft.start+1,bounds)} aria-valuemax={edge==='end'?bounds.duration:trimBoundaryTime(draft.end-1,bounds)} aria-valuenow={edge==='start'?start:end} aria-valuetext={`${formatVideoTrimTime(edge==='start'?start:end)}${edge==='end'?' · 종료 지점은 포함하지 않음':''}`} aria-describedby={hint} disabled={!usable} onPointerDown={event=>startDrag(event,edge)} onPointerMove={dragMove} onPointerUp={event=>stopDrag(event)} onPointerCancel={event=>stopDrag(event,true)} onLostPointerCapture={event=>{if(drag.current?.pointerId===event.pointerId)clearDrag(true);}} onKeyDown={event=>handleKeys(event,edge)} data-testid={`video-trim-${edge}-handle`}><span aria-hidden="true"/></button>)}
    </div></div>
    <div className="video-trim-times"><TrimTimeInput label="시작" value={start} max={trimBoundaryTime(draft.end-1,bounds)} step={1/bounds.fps} disabled={!usable} onCommit={seconds=>move('start',trimTimeBoundary(seconds,bounds))}/><span aria-hidden="true">—</span><TrimTimeInput label="종료" value={end} max={bounds.duration} step={1/bounds.fps} disabled={!usable} onCommit={seconds=>move('end',trimTimeBoundary(seconds,bounds))}/><small>종료 프레임 제외</small></div>
    <p id={hint} className="video-trim-hint">원본 전체에서 양끝을 드래그하거나 ← →로 1프레임씩 조절하세요. 적용하면 재생·내보내기 범위가 함께 바뀝니다. 취소하면 이전 구간으로 돌아갑니다.</p>
    <div className="video-trim-actions"><Button variant="ghost" size="sm" disabled={!usable} onClick={()=>{onApply(null);close();}} data-testid="video-trim-reset"><RotateCcw/>전체 영상 복원</Button><div><Button variant="ghost" size="sm" onClick={cancel} data-testid="video-trim-cancel"><X/>취소</Button><Button size="sm" disabled={!usable} onClick={()=>{clearDrag();onApply(exportVideoTrim(draftRef.current,bounds));close();}} data-testid="video-trim-apply"><Check/>자르기 적용</Button></div></div>
  </section>;
}
