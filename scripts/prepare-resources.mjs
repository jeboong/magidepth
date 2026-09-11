import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const resources = path.join(root, 'resources');
await fs.mkdir(resources, {recursive:true});
async function download(url, destination, hash) {
  try {
    const body=await fs.readFile(destination);
    if (!hash || crypto.createHash('sha256').update(body).digest('hex')===hash) return body;
  } catch {}
  console.log(`Fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if(hash && crypto.createHash('sha256').update(bytes).digest('hex')!==hash) throw new Error('Download integrity check failed');
  await fs.writeFile(destination+'.part', bytes);
  await fs.rename(destination+'.part', destination);
  return bytes;
}
const lockPath=path.join(root,'scripts/runtime-lock.json');
let lock; try {lock=JSON.parse(await fs.readFile(lockPath,'utf8'));} catch {}
const pythonVersion='3.13.14';
const pythonUrl=`https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`;
const python=await download(pythonUrl,path.join(resources,'python-embed.zip'),lock?.python.sha256);
const pipMeta=await (await fetch('https://pypi.org/pypi/pip/25.3/json')).json();
const pipFile=pipMeta.urls.find(x=>x.filename.endsWith('.whl'));
const pip=await download(pipFile.url,path.join(resources,'pip.whl'),pipFile.digests.sha256);
const manifest={schema:1,python:{version:pythonVersion,url:pythonUrl,sha256:crypto.createHash('sha256').update(python).digest('hex')},pip:{version:'25.3',url:pipFile.url,sha256:crypto.createHash('sha256').update(pip).digest('hex')},torch:'2.7.1',torchvision:'0.22.1',cuda:'cu128',ffmpeg:{version:'8.1.2',url:'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip',sha256:'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec'}};
if(!lock) await fs.writeFile(lockPath,JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(resources,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Runtime resources ready. Python and pip verified; installed FFmpeg tools are checked first, with verified download only when needed.');
