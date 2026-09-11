import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { requireLocalPath } from './policy';

export interface PlaybackRequest { jobId: string; source: string; ffmpeg: string; duration?: number; }
export interface PlaybackResult { path: string; proxy: true; cached: boolean; }
export interface PlaybackProgress { jobId: string; stage: 'playback'; progress: number; message: string; }
const VERSION = 'browser-preview-h264-yuv420p-720-v1';
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_FILES = 8;

/** Optional on-decoder-error browser proxy. Rendering always uses the original.
 * No models, downloads, source writes, shell invocation, or external services.
 */
export class MediaPlaybackManager {
  private readonly processes = new Map<string, ChildProcess>();
  private readonly preparing = new Set<string>();
  private readonly cancelled = new Set<string>();
  constructor(private readonly cacheDir: string, private readonly report: (event: PlaybackProgress) => void = () => {}) {
    requireLocalPath(cacheDir);
  }
  cancel(jobId: string): void {
    this.cancelled.add(jobId);
    // Limit remembered early cancellations; active ones are always retained.
    if (this.cancelled.size > 128) for (const id of this.cancelled) if (!this.processes.has(id) && id !== jobId) { this.cancelled.delete(id); break; }
    this.processes.get(jobId)?.kill();
  }
  async stop(): Promise<void> {
    const closing = [...this.processes.values()].map(child => new Promise<void>(resolve => child.once('close', () => resolve())));
    for (const jobId of this.preparing) this.cancel(jobId);
    await Promise.all(closing);
  }
  get busy(): boolean { return this.preparing.size > 0; }
  private cancelledError(): Error { return new Error('미리보기 준비를 취소했습니다.'); }
  private async removeOwned(file: string): Promise<void> {
    if (path.dirname(path.resolve(file)) !== path.resolve(this.cacheDir)) throw new Error('Invalid preview cache path');
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await fs.unlink(file); return; } catch (error: any) {
        if (error.code === 'ENOENT') return;
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
  private async prune(current: string): Promise<void> {
    const records = await Promise.all((await fs.readdir(this.cacheDir)).filter(name => /^[a-f0-9]{64}\.mp4$/.test(name)).map(async name => {
      const file = path.join(this.cacheDir, name); const stat = await fs.stat(file); return { file, size: stat.size, time: stat.mtimeMs };
    }));
    records.sort((a, b) => b.time - a.time);
    let bytes = records.reduce((sum, item) => sum + item.size, 0); let count = records.length;
    for (const item of [...records].reverse()) {
      if (count <= MAX_FILES && bytes <= MAX_BYTES) break;
      if (item.file === current) continue;
      try { await this.removeOwned(item.file); bytes -= item.size; count--; } catch { /* An existing player may still hold a cache file on Windows. Retry at the next preparation. */ }
    }
  }
  async prepare(request: PlaybackRequest): Promise<PlaybackResult> {
    const { jobId } = request;
    if (!/^[\w-]{1,100}$/.test(jobId)) throw new Error('Invalid playback job');
    if (this.cancelled.delete(jobId)) throw this.cancelledError();
    if (this.busy) throw new Error('다른 미리보기를 준비 중입니다.');
    this.preparing.add(jobId);
    try { return await this.prepareInternal(request); }
    finally { this.preparing.delete(jobId); this.cancelled.delete(jobId); }
  }
  private async prepareInternal({ jobId, source, ffmpeg, duration }: PlaybackRequest): Promise<PlaybackResult> {
    const original = await fs.realpath(requireLocalPath(source));
    const before = await fs.stat(original);
    if (!before.isFile()) throw new Error('원본 영상 파일을 찾지 못했습니다.');
    const executable = requireLocalPath(ffmpeg);
    await fs.mkdir(this.cacheDir, { recursive: true });
    const key = crypto.createHash('sha256').update(JSON.stringify([VERSION, original.toLowerCase(), before.size, before.mtimeMs])).digest('hex');
    const output = path.join(this.cacheDir, `${key}.mp4`);
    if (output.toLowerCase() === original.toLowerCase()) throw new Error('원본 영상은 덮어쓸 수 없습니다.');
    try {
      const stat = await fs.stat(output);
      if (stat.isFile() && stat.size > 0) {
        if (this.cancelled.delete(jobId)) throw this.cancelledError();
        await fs.utimes(output, new Date(), new Date());
        this.report({ jobId, stage: 'playback', progress: 1, message: '저장된 호환 미리보기를 재사용합니다. 원본은 그대로입니다.' });
        return { path: output, proxy: true, cached: true };
      }
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const partial = path.join(this.cacheDir, `${key}.part-${crypto.randomUUID()}.mp4`);
    this.report({ jobId, stage: 'playback', progress: 0, message: '브라우저 호환 미리보기를 준비합니다. 원본 영상은 변경하지 않습니다.' });
    try {
      if (this.cancelled.has(jobId)) throw this.cancelledError();
      await new Promise<void>((resolve, reject) => {
        const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', original,
          '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
          '-vf', "scale=w='min(iw,1280)':h='min(ih,720)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', partial];
        const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.processes.set(jobId, child);
        let errorText = ''; let pending = ''; let timedOut = false; let tooLarge = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30 * 60 * 1000);
        child.stderr?.on('data', (chunk: Buffer) => { errorText = (errorText + chunk.toString()).slice(-8000); });
        child.stdout?.on('data', (chunk: Buffer) => {
          pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('total_size=') && Number(line.slice(11)) > MAX_BYTES) { tooLarge = true; child.kill(); }
            if (line.startsWith('out_time_us=')) {
              const seconds = Number(line.slice(12)) / 1_000_000;
              const progress = duration && Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(.98, seconds / duration)) : .15;
              this.report({ jobId, stage: 'playback', progress, message: '호환 미리보기 생성 중 · 최대720p · 원본과 내보내기 품질은 그대로입니다.' });
            }
          }
        });
        child.once('error', error => { clearTimeout(timer); this.processes.delete(jobId); reject(error); });
        child.once('close', code => {
          clearTimeout(timer); this.processes.delete(jobId);
          if (this.cancelled.has(jobId)) reject(this.cancelledError());
          else if (timedOut) reject(new Error('미리보기 준비 시간이 초과되었습니다.'));
          else if (tooLarge) reject(new Error('호환 미리보기가1GB를 초과합니다. 짧게 잘라 다시 시도하거나 프레임 미리보기를 이용해 주세요.'));
          else if (code !== 0) reject(new Error(`호환 미리보기를 만들지 못했습니다. ${errorText.trim().slice(-1200)}`));
          else resolve();
        });
      });
      if (this.cancelled.has(jobId)) throw this.cancelledError();
      const after = await fs.stat(original);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('미리보기 준비 중 원본이 변경되었습니다. 다시 선택해 주세요.');
      const completed = await fs.stat(partial);
      if (!completed.size) throw new Error('호환 미리보기 파일이 비어 있습니다.');
      if (completed.size > MAX_BYTES) throw new Error('호환 미리보기가1GB를 초과합니다. 프레임 미리보기를 이용해 주세요.');
      await fs.rename(partial, output);
      await this.prune(output);
      if (this.cancelled.has(jobId)) { await this.removeOwned(output); throw this.cancelledError(); }
      this.report({ jobId, stage: 'playback', progress: 1, message: '호환 미리보기 준비 완료 · 분석과 내보내기는 원본 영상을 사용합니다.' });
      return { path: output, proxy: true, cached: false };
    } finally {
      this.cancelled.delete(jobId);
      await this.removeOwned(partial).catch(() => {});
    }
  }
}
