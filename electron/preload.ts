import {contextBridge,ipcRenderer,webUtils} from 'electron';
import type {DepthDeskAPI} from '../shared/contracts';
function subscribe(channel:string,callback:(event:any)=>void){const listener=(_event:unknown,data:any)=>callback(data);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);}
const api:DepthDeskAPI={
  getPreferences:()=>ipcRenderer.invoke('prefs:get'),setPreferences:p=>ipcRenderer.invoke('prefs:set',p),
  chooseVideo:()=>ipcRenderer.invoke('video:choose'),getFilePath:file=>webUtils.getPathForFile(file),
  pasteClipboardImage:()=>ipcRenderer.invoke('image:paste'),
  probeVideo:p=>ipcRenderer.invoke('video:probe',p),preview:p=>ipcRenderer.invoke('depth:preview',p),render:p=>ipcRenderer.invoke('depth:render',p),cancelJob:id=>ipcRenderer.invoke('depth:cancel',id),
  chooseOutputDir:()=>ipcRenderer.invoke('output:choose-dir'),chooseSavePath:p=>ipcRenderer.invoke('output:save-as',p),openFolder:p=>ipcRenderer.invoke('output:open-folder',p),revealFile:p=>ipcRenderer.invoke('output:reveal',p),
  getRuntime:()=>ipcRenderer.invoke('runtime:get'),installRuntime:()=>ipcRenderer.invoke('runtime:install'),getSystem:()=>ipcRenderer.invoke('system:get'),checkForUpdates:()=>ipcRenderer.invoke('update:check'),installUpdate:()=>ipcRenderer.invoke('update:install'),
  onProgress:cb=>subscribe('depth:progress',cb),onRuntime:cb=>subscribe('runtime:progress',cb),onUpdate:cb=>subscribe('update:progress',cb),
};
contextBridge.exposeInMainWorld('depthdesk',api);
