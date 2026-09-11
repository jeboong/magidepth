import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const compiled = await build({entryPoints:['src/lib/asyncDeadline.ts'],bundle:true,platform:'node',format:'cjs',write:false});
function fixture() {
  const timers = new Map(); let nextId = 0;
  const mod = {exports:{}};
  new Function('module','exports','setTimeout','clearTimeout',compiled.outputFiles[0].text)(
    mod,mod.exports,(callback,delay)=>{const id=++nextId;timers.set(id,{callback,delay});return id;},id=>timers.delete(id),
  );
  return {withDeadline:mod.exports.withDeadline,timers,expire:()=>{for(const {callback} of [...timers.values()])callback();}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test('deadline returns a successful reply and clears the timer',async()=>{
  const {withDeadline,timers}=fixture(),job=deferred();const result=withDeadline(job.promise,135000,'deadline');
  assert.equal(timers.size,1);job.resolve({ready:true});assert.deepEqual(await result,{ready:true});assert.equal(timers.size,0);
});
test('deadline propagates failures, including non-Error IPC failures',async()=>{
  const {withDeadline,timers}=fixture(),job=deferred();const result=withDeadline(job.promise,135000,'deadline');
  job.reject('catalog failed');await assert.rejects(result,/catalog failed/);assert.equal(timers.size,0);
});
test('deadline expires a permanently pending reply and ignores late success',async()=>{
  const {withDeadline,timers,expire}=fixture(),job=deferred();const result=withDeadline(job.promise,135000,'확인 시간 초과');
  const failure=assert.rejects(result,/확인 시간 초과/);expire();await failure;assert.equal(timers.size,0);
  job.resolve({ready:true});await flush();await assert.rejects(result,/확인 시간 초과/);
});
test('deadline attaches a rejection handler to a reply arriving after expiry',async()=>{
  const {withDeadline,expire}=fixture(),job=deferred();const result=withDeadline(job.promise,1,'deadline');
  const failure=assert.rejects(result,/deadline/);expire();await failure;job.reject(new Error('late rejection'));await flush();
});
test('abort interrupts a pending check and removes its timer',async()=>{
  const {withDeadline,timers}=fixture(),job=deferred(),controller=new AbortController();
  const result=withDeadline(job.promise,135000,'deadline',controller.signal),failure=assert.rejects(result,/중단/);
  controller.abort();await failure;assert.equal(timers.size,0);job.resolve('obsolete');await flush();
});
test('already-aborted signals reject immediately and completed operations ignore later abort',async()=>{
  const {withDeadline,timers}=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(withDeadline(new Promise(()=>{}),135000,'deadline',controller.signal),/중단/);assert.equal(timers.size,0);
  const second=new AbortController();assert.equal(await withDeadline(Promise.resolve('fresh'),135000,'deadline',second.signal),'fresh');second.abort();assert.equal(timers.size,0);
});
