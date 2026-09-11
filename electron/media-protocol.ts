import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { requireLocalPath } from './policy';

export function parseByteRange(value: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

const contentTypes: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.mts': 'video/mp2t', '.mxf': 'application/mxf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
};

/** Serve only app-registered canonical files, with correct seekable byte ranges.
 * Electron net.fetch(file://) can return partial bytes with status200 and omit
 * Content-Range/Length; never relay its file response to Chromium media players.
 */
export function createMediaProtocolHandler(allowedMedia: ReadonlySet<string>) {
  return async (request: Request): Promise<Response> => {
    let file: string;
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'depthdesk-media:' || url.host !== 'local' || url.username || url.password) return new Response('Forbidden', { status: 403 });
      file = await fs.realpath(requireLocalPath(url.searchParams.get('path')));
      if (!allowedMedia.has(file.toLowerCase())) return new Response('Forbidden', { status: 403 });
    } catch { return new Response('Not found', { status: 404 }); }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); return new Response('Not found', { status: 404 }); }
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Last-Modified': stat.mtime.toUTCString(),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const range = parseByteRange(request.method === 'GET' ? request.headers.get('Range') : null, stat.size);
      if (range === 'invalid') {
        await handle.close(); headers.set('Content-Range', `bytes */${stat.size}`); headers.set('Content-Length', '0');
        return new Response(null, { status: 416, headers });
      }
      if (range) { headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`); headers.set('Content-Length', String(range.end - range.start + 1)); }
      if (request.method === 'HEAD' || stat.size === 0) { await handle.close(); return new Response(null, { status: range ? 206 : 200, headers }); }
      const stream = handle.createReadStream({ start: range?.start ?? 0, end: range?.end ?? stat.size - 1, autoClose: true, signal: request.signal });
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
    } catch {
      await handle?.close().catch(() => {});
      return new Response('Not found', { status: 404 });
    }
  };
}
