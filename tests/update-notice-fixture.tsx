// UI-only fixture: no Electron API, network download, installer or main App.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { UpdateStatus } from '../shared/contracts';
import { UpdateNotice } from '../src/components/UpdateNotice';
import '../src/styles.css';

const mock = {
  downloads: 0, installs: 0, rejectNext: false,
  setStatus: (_status: UpdateStatus) => {}, setBlocked: (_blocked: boolean) => {},
  finishDownload: () => {}, progress: (_percent: number) => {},
};
(window as any).__updateNoticeMock = mock;
function Fixture() {
  const [status, setStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [blocked, setBlocked] = useState(false);
  mock.setStatus = setStatus; mock.setBlocked = setBlocked;
  mock.progress = percent => setStatus(current => ({ status: 'downloading', version: current.version, percent }));
  const download = async () => {
    mock.downloads++;
    if (mock.rejectNext) {
      mock.rejectNext = false;
      setStatus({ status: 'error', version: status.version, message: 'FAKE DOWNLOAD ERROR · 실제 네트워크 호출 없음' });
      throw new Error('FAKE DOWNLOAD ERROR · 실제 네트워크 호출 없음');
    }
    setStatus({ status: 'downloading', version: status.version, percent: 0 });
    await new Promise<void>(resolve => { mock.finishDownload = () => { setStatus({ status: 'ready', version: status.version, percent: 100 }); resolve(); }; });
  };
  const install = async () => {
    if (blocked) throw new Error('Fixture install was called while blocked');
    mock.installs++;
  };
  return <main style={{ padding: '64px 0', width: '100%', minHeight: '100vh', background: 'hsl(var(--background))' }}>
    <h1 style={{ padding: '0 24px', fontSize: 20 }}>UpdateNotice isolated UI fixture · no real update actions</h1>
    <UpdateNotice status={status} blocked={blocked} onDownload={download} onInstall={install} />
    <input aria-label="계속 작업하기" placeholder="배너가 나타나도 작업을 계속합니다" style={{ margin: '24px', padding: '12px', width: '420px', background: 'hsl(var(--secondary))', borderRadius: 8 }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
