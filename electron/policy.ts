import path from 'node:path';
import {defaultPreferences,defaultOptions,defaultCloakOptions,type Preferences,type DepthOptions,type CloakOptions} from '../shared/contracts';
export function safeAssetPath(root:string,pathname:string){
  const file=path.resolve(root,'.'+pathname);
  const relative=path.relative(root,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Forbidden asset path');
  return file;
}
export function sanitizeOptions(value:any):DepthOptions{
  const input={...defaultOptions,...value};
  const maps=Array.isArray(input.maps)?[...new Set(input.maps.filter((m:any)=>['source','depth','normal','alpha','basecolor','metallic','roughness','specular'].includes(m)))]:[];
  return {
    maps:maps.length?maps as DepthOptions['maps']:['depth'],
    processingMode:input.processingMode==='advanced'?'advanced':'fast',
    previewMap:['source','depth','normal','alpha','basecolor','metallic','roughness','specular'].includes(input.previewMap)?input.previewMap:'depth',
    normalStrength:Number.isFinite(input.normalStrength)?Math.min(5,Math.max(.1,input.normalStrength)):1,
    steps:[1,2,4,8].includes(input.steps)?input.steps:4,
    model:input.model==='image-small'?'image-small':'video-small',
    inputSize:([280,392,518,700].includes(input.inputSize)?input.inputSize:392),
    nearWhite:input.nearWhite!==false,
    gamma:Number.isFinite(input.gamma)?Math.min(3,Math.max(.2,input.gamma)):1,
    contrast:Number.isFinite(input.contrast)?Math.min(1,Math.max(0,input.contrast)):.5,
    device:['auto','cuda','cpu'].includes(input.device)?input.device:'auto',
    precision:['auto','fp16','fp32'].includes(input.precision)?input.precision:'auto',
    outputSize:['source','1080','720'].includes(input.outputSize)?input.outputSize:'source',
    codec:input.codec==='hevc'?'hevc':'h264',
  };
}
export function sanitizePreferences(value:any):Preferences{
  return {...defaultPreferences,theme:['dark','light','system'].includes(value?.theme)?value.theme:'dark',
    outputDir:typeof value?.outputDir==='string'?value.outputDir:'',tutorialDone:value?.tutorialDone===true,
    autoUpdate:value?.autoUpdate!==false,options:sanitizeOptions(value?.options),
    cloakOptions:sanitizeCloakOptions(value?.cloakOptions),
    cloakOutputDir:typeof value?.cloakOutputDir==='string'?value.cloakOutputDir:''};
}
export function sanitizeCloakOptions(value:any):CloakOptions{
  const d=defaultCloakOptions, v=value&&typeof value==='object'?value:{};
  const g=v.grid&&typeof v.grid==='object'?v.grid:{};
  const num=(value:unknown,min:number,max:number,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
  const bool=(value:unknown,fallback:boolean)=>typeof value==='boolean'?value:fallback;
  const shape=(value:unknown,fallback:'ellipse'|'rect')=>value==='rect'||value==='ellipse'?value:fallback;
  return {
    methods:{A:bool(v.methods?.A,d.methods.A),B:bool(v.methods?.B,d.methods.B),C:bool(v.methods?.C,d.methods.C)},
    eps:num(v.eps,2,30,d.eps),strength:num(v.strength,.01,.2,d.strength),
    use_grid:bool(v.use_grid,d.use_grid),tracking:bool(v.tracking,d.tracking),
    quality:['visually_lossless','high','balanced','small','lossless','hevc_high'].includes(v.quality)?v.quality:d.quality,
    pad_enabled:bool(v.pad_enabled,d.pad_enabled),pad_seconds:num(v.pad_seconds,1,15,d.pad_seconds),
    pad_position:v.pad_position==='before'?'before':'after',
    roi_shape:shape(v.roi_shape,d.roi_shape),detect_score:num(v.detect_score,.05,.99,d.detect_score),
    man_cx:num(v.man_cx,0,1,d.man_cx),man_cy:num(v.man_cy,0,1,d.man_cy),
    man_w:num(v.man_w,.05,1,d.man_w),man_h:num(v.man_h,.05,1,d.man_h),
    grid:{rows:Math.round(num(g.rows,1,20,d.grid.rows)),cols:Math.round(num(g.cols,1,20,d.grid.cols)),
      thickness:Math.round(num(g.thickness,1,8,d.grid.thickness)),auto_thickness:bool(g.auto_thickness,d.grid.auto_thickness),
      color:[0,1,2].map(i=>Math.round(num(g.color?.[i],0,255,d.grid.color[i]))) as [number,number,number],
      opacity:num(g.opacity,.05,1,d.grid.opacity),margin:num(g.margin,0,.4,d.grid.margin),shape:shape(g.shape,d.grid.shape),
      align_angle:bool(g.align_angle,d.grid.align_angle),dots:bool(g.dots,d.grid.dots),
      dot_radius:Math.round(num(g.dot_radius,1,8,d.grid.dot_radius)),line_aa:bool(g.line_aa,d.grid.line_aa)}
  };
}
export function requireLocalPath(input:unknown){
  if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0')||input.startsWith('\\\\'))throw new Error('로컬 파일의 절대 경로가 필요합니다.');
  const resolved=path.resolve(input);
  if(resolved.startsWith('\\\\')||resolved.startsWith('//')||resolved.slice(2).includes(':'))throw new Error('네트워크, 장치 또는 스트림 경로는 지원하지 않습니다.');
  return resolved;
}
