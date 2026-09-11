import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import type { UpdateStatus } from '../../shared/contracts';
import { Button } from './ui/button';
import './UpdateNotice.css';

const dismissedVersions = new Set<string>();
export interface UpdateNoticeProps {
  status: UpdateStatus;
  blocked?: boolean;
  onDownload: () => Promise<void>;
  onInstall: () => Promise<void>;
}

/** Non-modal and never autofocuses: the user's work remains in front. */
export function UpdateNotice({ status, blocked = false, onDownload, onInstall }: UpdateNoticeProps) {
  const [dismissed, setDismissed] = useState<string>();
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const version = status.version || '';
  useEffect(() => { setActionError(''); setActing(false); }, [version]);
  if (!version || dismissed === version || dismissedVersions.has(version) || !['available', 'downloading', 'ready', 'error'].includes(status.status)) return null;
  const downloading = status.status === 'downloading';
  const ready = status.status === 'ready';
  const failed = status.status === 'error';
  const percent = Math.max(0, Math.min(100, Math.round(status.percent || 0)));
  const dismiss = () => { dismissedVersions.add(version); setDismissed(version); };
  const act = async (fn: () => Promise<void>) => {
    setActionError(''); setActing(true);
    try { await fn(); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setActing(false); }
  };
  const title = ready ? '새 마법, 펼칠 준비 완료' : downloading ? '새 마법을 챙기는 중' : failed ? '업데이트가 잠깐 삐끗했어요' : '새 마법이 도착했어요';
  const detail = ready
    ? blocked ? '진행 중인 작업을 마친 뒤 설치할 수 있습니다.' : '다시 시작하면 업데이트를 적용합니다. 자동으로 앱을 닫지 않아요.'
    : downloading ? '작업은 계속하세요. 다운로드가 끝나도 앱은 자동 종료되지 않습니다.'
      : failed ? status.message || '연결을 확인하고 다시 다운로드해 주세요.'
        : 'MagiMagic의 새 버전이 있습니다. 원할 때 받아두세요.';
  return <section className={`update-notice update-notice-${status.status}`} aria-label="MagiMagic 업데이트 알림" data-update-version={version}>
    <span className="update-notice-icon" aria-hidden="true">{ready ? <Check size={20} /> : downloading ? <LoaderCircle size={20} className="update-notice-spin" /> : <Sparkles size={20} />}</span>
    <div className="update-notice-copy">
      <div className="update-notice-heading" role="status" aria-live="polite"><strong>{title}</strong><span>v{version}</span></div>
      <p>{detail}</p>
      {downloading && <div className="update-notice-progress-row"><div className="update-notice-progress" role="progressbar" aria-label="업데이트 다운로드" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div><span>{percent}%</span></div>}
      {actionError && <p className="update-notice-error" role="alert">{actionError}</p>}
    </div>
    <div className="update-notice-actions">
      {!downloading && <Button size="sm" disabled={acting || (ready && blocked)} onClick={() => void act(ready ? onInstall : onDownload)}>
        {acting ? <LoaderCircle className="update-notice-spin" /> : ready ? <RefreshCw /> : <ArrowDownToLine />}
        {ready ? '다시 시작해 설치' : failed ? '다운로드 재시도' : '다운로드'}
      </Button>}
      <Button size="sm" variant="ghost" onClick={dismiss} aria-label={`v${version} 업데이트 알림 나중에 보기`}>나중에<X size={13} /></Button>
    </div>
  </section>;
}
