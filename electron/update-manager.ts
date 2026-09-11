import type { UpdateStatus } from '../shared/contracts';

interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: any, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, forceRunAfter?: boolean): void;
}
export interface UpdateManagerOptions {
  updater: Updater;
  packaged: boolean;
  autoDownload: () => boolean;
  busy: () => boolean;
  notify: (status: UpdateStatus) => void;
  beforeInstall: () => void;
}

/** Metadata checks and downloads are separate; installing is always explicit. */
export class UpdateManager {
  private state: UpdateStatus = { status: 'idle' };
  private checkPromise?: Promise<void>;
  private downloadPromise?: Promise<void>;
  constructor(private readonly options: UpdateManagerOptions) {
    const updater = options.updater;
    // Manage the setting ourselves so switching it does not turn off checks.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('checking-for-update', () => this.set({ status: 'checking' }));
    updater.on('update-available', info => {
      this.set({ status: 'available', version: info.version });
      if (options.autoDownload()) queueMicrotask(() => { void this.download().catch(() => {}); });
    });
    updater.on('update-not-available', info => this.set({ status: 'up-to-date', version: info.version }));
    updater.on('download-progress', info => this.set({ status: 'downloading', version: this.state.version, percent: Math.max(0, Math.min(100, Number(info.percent) || 0)) }));
    updater.on('update-downloaded', info => this.set({ status: 'ready', version: info.version, percent: 100 }));
    updater.on('error', error => this.set({ status: 'error', version: this.state.version, message: error.message || String(error) }));
  }
  private set(status: UpdateStatus): void { this.state = { ...status }; this.options.notify(this.getStatus()); }
  getStatus(): UpdateStatus { return { ...this.state }; }
  async check(): Promise<void> {
    if (!this.options.packaged) { this.set({ status: 'up-to-date', message: '개발 빌드에서는 업데이트를 설치하지 않습니다.' }); return; }
    if (this.checkPromise) return this.checkPromise;
    if (this.downloadPromise || this.state.status === 'ready') return;
    this.checkPromise = Promise.resolve().then(async () => {
      try { await this.options.updater.checkForUpdates(); }
      catch (error) { this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) }); }
      finally { this.checkPromise = undefined; }
    });
    return this.checkPromise;
  }
  async download(): Promise<void> {
    if (!this.options.packaged) throw new Error('업데이트 다운로드는 설치된 앱에서 이용해 주세요.');
    if (this.downloadPromise) return this.downloadPromise;
    if (this.state.status === 'ready') return;
    if (!this.state.version || !['available', 'error'].includes(this.state.status)) throw new Error('먼저 업데이트 확인을 실행해 주세요.');
    const version = this.state.version;
    this.set({ status: 'downloading', version, percent: 0 });
    this.downloadPromise = Promise.resolve().then(async () => {
      try { await this.options.updater.downloadUpdate(); }
      catch (error) { this.set({ status: 'error', version, message: error instanceof Error ? error.message : String(error) }); throw error; }
      finally { this.downloadPromise = undefined; }
    });
    return this.downloadPromise;
  }
  install(): void {
    if (!this.options.packaged || this.state.status !== 'ready') throw new Error('업데이트 다운로드가 완료된 뒤 설치해 주세요.');
    if (this.options.busy()) throw new Error('렌더·설치·모델 다운로드·미리보기 작업이 끝난 뒤 업데이트해 주세요.');
    this.options.beforeInstall();
    this.options.updater.quitAndInstall(false, true);
  }
}
