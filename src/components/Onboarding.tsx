import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Layers3, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, X} from 'lucide-react';
import type {RuntimeStatus} from '../../shared/contracts';
import {Button} from './ui/button';
import {OnboardingMascot} from './OnboardingMascot';
import {errorMessage} from '../lib/utils';
import './Onboarding.css';

export type StartupWorkspace='depth'|'cloak';
interface OnboardingProps {
  open:boolean;
  initialSelection?:StartupWorkspace;
  runtime:RuntimeStatus;
  browserDemo?:boolean;
  reopen?:boolean;
  onClose:()=>void;
  onInstall:(workspace:StartupWorkspace)=>Promise<RuntimeStatus>;
  onComplete:(workspace:StartupWorkspace)=>Promise<void>;
}
const modules={
  depth:{name:'MagiDepth',eyebrow:'DEPTH & MATERIAL MAPS',description:'이미지와 영상에서 깊이·표면·재질 맵을 꺼내세요.',icon:Layers3},
  cloak:{name:'MagiCloak',eyebrow:'FACE GRID & IMAGE EFFECTS',description:'얼굴 격자와 이미지 효과를 한곳에서 다루세요.',icon:ShieldCheck},
};
export function Onboarding({open,initialSelection,runtime,browserDemo=false,reopen=false,onClose,onInstall,onComplete}:OnboardingProps){
  const [selection,setSelection]=useState<StartupWorkspace|null>(initialSelection??null);
  const [step,setStep]=useState<'welcome'|'choose'|'setup'>('welcome');
  const [hoverSide,setHoverSide]=useState<StartupWorkspace|null>(null);
  const [installPending,setInstallPending]=useState(false);
  const [saving,setSaving]=useState(false);
  const [localError,setLocalError]=useState('');
  const pending=useRef(false);
  const left=useRef<HTMLButtonElement>(null),right=useRef<HTMLButtonElement>(null);
  const welcomeNext=useRef<HTMLButtonElement>(null);
  const wasOpen=useRef(false);
  useEffect(()=>{
    if(open&&!wasOpen.current){setSelection(initialSelection??null);setStep('welcome');setHoverSide(null);setLocalError('');setSaving(false);}
    wasOpen.current=open;
  },[open,initialSelection]);
  useEffect(()=>{
    if(!open)return;
    setHoverSide(null);
    const frame=requestAnimationFrame(()=>{
      if(step==='welcome')welcomeNext.current?.focus();
      else if(step==='choose')(selection==='cloak'?right:left).current?.focus();
    });
    return()=>cancelAnimationFrame(frame);
    // Focus follows page changes, not each pointer selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,step]);
  const ready=selection==='cloak'?!!runtime.cloakReady:selection==='depth'&&runtime.ready&&runtime.depthModelsReady===true;
  const installing=runtime.installing||installPending;
  const selected=selection?modules[selection]:null;
  const percent=Math.round(Math.max(0,Math.min(1,Number.isFinite(runtime.progress)?runtime.progress:0))*100);
  const issue=localError||(!installing?runtime.error:'');
  const choose=(next:StartupWorkspace)=>{if(saving||installPending)return;setSelection(next);setLocalError('');};
  const arrowSelect=(event:KeyboardEvent<HTMLButtonElement>)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const next=event.key==='ArrowLeft'||event.key==='Home'?'depth':'cloak';choose(next);(next==='depth'?left:right).current?.focus();
  };
  const finish=async()=>{
    if(!selection||pending.current)return;
    pending.current=true;setSaving(true);setLocalError('');
    try{await onComplete(selection);}catch(error){setLocalError(errorMessage(error));}
    finally{pending.current=false;setSaving(false);}
  };
  const next=()=>{if(!selection)return;if(ready&&!installing)void finish();else{setLocalError('');setStep('setup');}};
  const install=async()=>{
    if(!selection||pending.current||installing||browserDemo)return;
    pending.current=true;setInstallPending(true);setLocalError('');
    try{
      const result=await onInstall(selection);
      if(!(selection==='cloak'?result.cloakReady:result.ready&&result.depthModelsReady)&&!result.installing)setLocalError(result.error||'셋업이 완료되지 않았습니다. 상태를 확인하고 다시 시도해 주세요.');
    }catch(error){setLocalError(errorMessage(error));}
    finally{pending.current=false;setInstallPending(false);}
  };
  // Completing onboarding while an install runs only leaves this panel; it never
  // cancels that install. Workspace/runtime guards remain responsible for jobs.
  const browse=async()=>{
    if(!selection||saving)return;
    setSaving(true);setLocalError('');
    try{await onComplete(selection);}catch(error){setLocalError(errorMessage(error));}
    finally{setSaving(false);}
  };
  return <DialogPrimitive.Root open={open} onOpenChange={value=>{if(!value&&reopen&&!installing&&!saving)onClose();}}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="onboarding-backdrop"/>
      <DialogPrimitive.Content className={`onboarding-modal onboarding-step-${step} ${selection?`onboarding-${selection}`:''}`} data-onboarding-step={step} onEscapeKeyDown={event=>{if(!reopen||installing||saving)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()} onInteractOutside={event=>event.preventDefault()} onOpenAutoFocus={event=>{event.preventDefault();welcomeNext.current?.focus();}}>
        {reopen&&!installing&&<button className="onboarding-close" onClick={onClose} disabled={saving} aria-label="기능 선택 닫기"><X size={18}/></button>}
        <div className="onboarding-wordmark"><Sparkles size={15}/><span>MagiMagic <small>매지매직</small></span><span className="onboarding-step">{step==='welcome'?'WELCOME TO MAGIMAGIC':step==='choose'?'01 · CHOOSE YOUR MAGIC':'02 · ONE-TIME SETUP'}</span></div>
        <div className="onboarding-flow">
          <div className={`onboarding-heading${step==='setup'?' onboarding-setup-heading':''}`}>
            {step==='setup'&&<span className="onboarding-module-chip">{selection==='cloak'?<ShieldCheck size={15}/>:<Layers3 size={15}/>} {selected?.name}</span>}
            <DialogPrimitive.Title>{step==='welcome'?'환영합니다!':step==='choose'?'어느 쪽 마법을 꺼낼까요?':ready&&!installing?'준비 끝. 이제 꺼내 쓰세요.':installing?'작업실을 준비하고 있어요.':'처음 한 번, 작업실을 준비해요.'}</DialogPrimitive.Title>
            <DialogPrimitive.Description>{step==='welcome'?'매지코의 마법을 느껴보세요':step==='choose'?'얼굴의 왼쪽은 깊이, 오른쪽은 격자. 시작할 작업실을 골라주세요.':ready&&!installing?'기존 설치를 확인했습니다. 준비된 구성은 다시 다운로드하지 않습니다.':'MagiMagic 사용을 위해 최초 1회 셋업이 필요합니다. 인터넷 환경과 PC 성능에 따라 수십 분 이상 소요될 수 있습니다.'}</DialogPrimitive.Description>
          </div>
          <div className="onboarding-mascot-stage" role={step==='choose'?'radiogroup':undefined} aria-label={step==='choose'?'시작할 MagiMagic 기능':undefined}>
            <div className="onboarding-face-aura" aria-hidden="true"/>
            <OnboardingMascot active={open} selection={step==='choose'?selection:null} hoverSide={step==='choose'?hoverSide:null}/>
            {step==='choose'&&<div className="onboarding-face-midline" aria-hidden="true"/>}
            {step==='choose'&&(['depth','cloak'] as const).map((key,index)=>{
              const item=modules[key],Icon=item.icon,active=selection===key;
              return <button key={key} ref={key==='depth'?left:right} className={`onboarding-half onboarding-half-${key}${active?' is-selected':''}`} role="radio" aria-checked={active} aria-label={`${index===0?'왼쪽':'오른쪽'} 얼굴 · ${item.name} 선택`} tabIndex={selection?(active?0:-1):(index===0?0:-1)} onClick={()=>choose(key)} onKeyDown={arrowSelect} onPointerEnter={()=>setHoverSide(key)} onPointerLeave={()=>setHoverSide(value=>value===key?null:value)} onFocus={()=>setHoverSide(key)} onBlur={()=>setHoverSide(value=>value===key?null:value)} disabled={saving} data-testid={`onboarding-${key}-half`}>
                <span className="onboarding-half-frame" aria-hidden="true"/>
                <span className="onboarding-half-check" aria-hidden="true">{active?<Check size={16}/>:<Icon size={16}/>}</span>
                <span className="onboarding-half-label"><span><Icon size={15}/>{item.name}</span><small>{active?'선택됨':index===0?'왼쪽 얼굴을 눌러주세요':'오른쪽 얼굴을 눌러주세요'}</small></span>
              </button>;
            })}
          </div>
        </div>
        {step==='welcome'?<div className="onboarding-footer onboarding-welcome-footer"><span><ShieldCheck size={14}/>내 PC에서 처리 · 원본 보존</span><Button ref={welcomeNext} size="lg" onClick={()=>setStep('choose')} data-testid="onboarding-welcome-next">시작하기<ArrowRight/></Button></div>:step==='choose'?<>
          <div className="onboarding-choice-copy" aria-live="polite">
            {selected?<><span>{selected.eyebrow}</span><p>{selected.description}</p><small>{ready?'이미 준비되어 있어요. 추가 설치 없이 바로 열 수 있습니다.':selection==='cloak'?'가벼운 기본 도구로 시작합니다. PyTorch 설치는 필요하지 않습니다.':'AI 실행 환경을 준비한 뒤 사용할 수 있습니다.'}</small></>:<><span>ONE FACE. TWO WORKSPACES.</span><p>이상하게 생겼지만, 쓸모는 확실하게.</p><small>Tab으로 얼굴에 이동하고 ← → 방향키로 선택할 수도 있어요.</small></>}
          </div>
          {localError&&<p className="onboarding-error" role="alert">{localError}</p>}
          <div className="onboarding-footer"><Button variant="ghost" onClick={()=>setStep('welcome')} disabled={saving}><ArrowLeft/>돌아가기</Button><Button size="lg" onClick={next} disabled={!selection||saving} data-testid="onboarding-next">{saving?<><LoaderCircle className="animate-spin"/>여는 중…</>:<>다음<ArrowRight/></>}</Button></div>
        </>:<>
          <div className="onboarding-setup-summary">
            <div className="onboarding-setup-icon">{ready&&!installing?<CheckCircle2 size={30}/>:installing?<LoaderCircle size={30} className="animate-spin"/>:<Download size={30}/>}</div>
            <div><h3>{selection==='cloak'?'MagiCloak · 경량 기본 도구':'MagiDepth · AI 실행 환경 + 기본 깊이 모델'}</h3><p>{selection==='cloak'?'전용 Python, NumPy, OpenCV를 준비합니다. PyTorch/CUDA는 설치하지 않습니다.':'PyTorch/CUDA와 기본 이미지·영상 Depth 모델을 함께 준비합니다. 대용량 다운로드와 충분한 저장 공간이 필요합니다.'}</p><p>{selection==='cloak'?'얼굴 검출 모델은 해당 기능을 처음 사용할 때 별도로 준비될 수 있습니다.':'Alpha·고급 Normal·재질 AI 모델은 추출할 맵에서 다운로드 버튼을 눌러 준비합니다. 필요 없는 모델은 받지 않습니다.'}</p></div>
          </div>
          <div className="onboarding-setup-notes"><p><Check size={14}/>이미 사용할 수 있는 FFmpeg·엔진은 검증 후 재사용합니다.</p><p><ShieldCheck size={14}/>설치는 앱 전용 공간에 진행하며, 영상은 외부로 업로드하지 않습니다.</p>{selection==='depth'&&<p><Download size={14}/>기본 12 GB, 고급 AI 사용 시 25 GB 이상의 여유 공간을 권장합니다.</p>}</div>
          {installing&&<div className="onboarding-install-progress"><div><span>엔진 셋업</span><strong>{percent}%</strong></div><div className="onboarding-progress-track" role="progressbar" aria-label="엔진 준비 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width:`${percent}%`}}/></div><p role="status">{runtime.message||'필요한 구성 요소를 확인하고 있습니다.'}</p></div>}
          {issue&&!installing&&<div className="onboarding-error" role="alert"><strong>준비를 완료하지 못했어요.</strong><p>{issue}</p><small>기존 설치는 유지됩니다. 연결과 저장 공간을 확인한 뒤 다시 시도하거나, 나중에 준비할 수 있습니다.</small></div>}
          {browserDemo&&<p className="onboarding-demo-note">브라우저에서는 화면을 둘러볼 수 있습니다. 실제 엔진 셋업은 Windows 데스크톱 앱에서 실행됩니다.</p>}
          <div className="onboarding-setup-footer">
            <Button variant="ghost" onClick={()=>{setStep('choose');setLocalError('');}} disabled={installing||saving}><ArrowLeft/>다른 기능 선택</Button>
            <div>{!ready&&<Button variant="ghost" onClick={()=>void browse()} disabled={saving}>{saving?'여는 중…':installing?'설치 중 작업실 둘러보기':'나중에 준비'}</Button>}
              {ready&&!installing?<Button size="lg" onClick={()=>void finish()} disabled={saving}>{saving?<LoaderCircle className="animate-spin"/>:<ArrowRight/>}작업실 열기</Button>:<Button size="lg" onClick={()=>void install()} disabled={installing||saving||browserDemo}>{installing?<LoaderCircle className="animate-spin"/>:issue?<RefreshCw/>:<Download/>}{installing?'준비 중…':issue?'다시 시도':'셋업 시작'}</Button>}
            </div>
          </div>
          {installing&&<p className="onboarding-background-note">작업실을 둘러보는 동안에도 셋업은 계속됩니다. 이 버튼은 설치를 취소하지 않습니다.</p>}
        </>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
