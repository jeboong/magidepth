import path from 'node:path';
import {defaultPreferences,defaultOptions,type Preferences,type DepthOptions} from '../shared/contracts';
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
    autoUpdate:value?.autoUpdate!==false,options:sanitizeOptions(value?.options)};
}
export function requireLocalPath(input:unknown){
  if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0')||input.startsWith('\\\\'))throw new Error('로컬 파일의 절대 경로가 필요합니다.');
  const resolved=path.resolve(input);
  if(resolved.startsWith('\\\\')||resolved.startsWith('//')||resolved.slice(2).includes(':'))throw new Error('네트워크, 장치 또는 스트림 경로는 지원하지 않습니다.');
  return resolved;
}
