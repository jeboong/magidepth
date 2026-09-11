export interface VideoTrimRange {start:number;end:number}
export interface VideoTrimFrames {start:number;end:number}
export interface VideoTrimBounds {duration:number;fps:number;frames:number}
export interface VideoPlaybackWindow {start:number;end:number;last:number;duration:number;frames:number}
export type VideoTrimEdge='start'|'end';

export function videoTrimBounds(duration:number,fps:number):VideoTrimBounds {
  const safeDuration=Number.isFinite(duration)&&duration>0?duration:0;
  const safeFps=Number.isFinite(fps)&&fps>0?fps:30;
  return {duration:safeDuration,fps:safeFps,frames:safeDuration>0?Math.max(1,Math.round(safeDuration*safeFps)):0};
}
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function trimBoundaryTime(frame:number,bounds:VideoTrimBounds):number {
  if(frame>=bounds.frames)return bounds.duration;
  return clamp(frame/bounds.fps,0,bounds.duration);
}
export function trimTimeBoundary(time:number,bounds:VideoTrimBounds):number {
  if(!Number.isFinite(time))return 0;
  if(time>=bounds.duration)return bounds.frames;
  return clamp(Math.round(time*bounds.fps),0,bounds.frames);
}
export function normalizeVideoTrim(value:VideoTrimRange|null,bounds:VideoTrimBounds):VideoTrimFrames {
  if(!bounds.frames)return {start:0,end:0};
  const start=clamp(trimTimeBoundary(value?.start??0,bounds),0,bounds.frames-1);
  const end=clamp(trimTimeBoundary(value?.end??bounds.duration,bounds),start+1,bounds.frames);
  return {start,end};
}
export function moveVideoTrim(range:VideoTrimFrames,edge:VideoTrimEdge,frame:number,bounds:VideoTrimBounds):VideoTrimFrames {
  if(!bounds.frames)return {start:0,end:0};
  const rounded=Number.isFinite(frame)?Math.round(frame):range[edge];
  return edge==='start'?{...range,start:clamp(rounded,0,range.end-1)}:{...range,end:clamp(rounded,range.start+1,bounds.frames)};
}
export function exportVideoTrim(range:VideoTrimFrames,bounds:VideoTrimBounds):VideoTrimRange|null {
  if(!bounds.frames||(range.start===0&&range.end===bounds.frames))return null;
  return {start:trimBoundaryTime(range.start,bounds),end:trimBoundaryTime(range.end,bounds)};
}
export function trimPreviewTime(range:VideoTrimFrames,edge:VideoTrimEdge,bounds:VideoTrimBounds):number {
  const frame=edge==='start'?range.start:Math.max(range.start,range.end-1);
  return clamp(frame/bounds.fps,0,Math.max(0,bounds.duration-1/bounds.fps));
}
/** Source timestamps remain absolute; the collapsed playback timeline is clip-relative. */
export function videoPlaybackWindow(value:VideoTrimRange|null,bounds:VideoTrimBounds):VideoPlaybackWindow {
  const range=normalizeVideoTrim(value,bounds);
  const start=trimBoundaryTime(range.start,bounds),end=trimBoundaryTime(range.end,bounds);
  const last=Math.max(start,Math.min((range.end-1)/bounds.fps,end));
  return {start,end,last,duration:Math.max(0,end-start),frames:range.end-range.start};
}
export function clampPlaybackTime(time:number,window:VideoPlaybackWindow):number {
  return clamp(Number.isFinite(time)?time:window.start,window.start,window.last);
}
export function formatVideoTrimTime(seconds:number):string {
  const value=Number.isFinite(seconds)?Math.max(0,seconds):0;
  const millis=Math.round(value*1000),hours=Math.floor(millis/3600000),minutes=Math.floor(millis/60000)%60,secs=Math.floor(millis/1000)%60;
  return `${hours?`${hours.toString().padStart(2,'0')}:`:''}${minutes.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}.${(millis%1000).toString().padStart(3,'0')}`;
}
