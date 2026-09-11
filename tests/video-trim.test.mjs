import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/components/videoTrim.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(mod,mod.exports);
const {videoTrimBounds,trimBoundaryTime,trimTimeBoundary,normalizeVideoTrim,moveVideoTrim,exportVideoTrim,trimPreviewTime,formatVideoTrimTime,videoPlaybackWindow,clampPlaybackTime}=mod.exports;

test('applied playback uses source boundaries but exposes a shorter clip-relative timeline',()=>{
  const window=videoPlaybackWindow({start:.4,end:1.5},videoTrimBounds(2,30));
  assert.deepEqual(window,{start:.4,end:1.5,last:44/30,duration:1.1,frames:33});
  assert.equal(clampPlaybackTime(0,window),.4);
  assert.equal(clampPlaybackTime(2,window),44/30);
  assert.equal(clampPlaybackTime(1.5,window),44/30);
  assert.equal(clampPlaybackTime(NaN,window),.4);
  assert.equal(clampPlaybackTime(1,window),1);
  assert.ok(clampPlaybackTime(999,window)<window.end,'exclusive end is never seekable');
});

test('one-frame, empty, restored and fractional-FPS playback windows are bounded',()=>{
  const bounds=videoTrimBounds(2,30),single=videoPlaybackWindow({start:1,end:31/30},bounds);
  assert.equal(single.frames,1);assert.equal(single.start,single.last);
  assert.equal(clampPlaybackTime(-1,single),1);assert.equal(clampPlaybackTime(10,single),1);
  const restored=videoPlaybackWindow(null,bounds);
  assert.equal(restored.start,0);assert.equal(restored.end,2);assert.equal(restored.last,59/30);
  const empty=videoPlaybackWindow(null,videoTrimBounds(0,0));
  assert.deepEqual(empty,{start:0,end:0,last:0,duration:0,frames:0});
  const fractional=videoTrimBounds(10.01,30000/1001);
  for(let start=0;start<fractional.frames;start++){
    const window=videoPlaybackWindow({start:start/fractional.fps,end:10.01},fractional);
    assert.ok(window.start<=window.last&&window.last<window.end);
    assert.equal(clampPlaybackTime(-100,window),window.start);
    assert.equal(clampPlaybackTime(100,window),window.last);
  }
});
test('video trim is optional and full range exports null',()=>{
  const bounds=videoTrimBounds(10,30),full=normalizeVideoTrim(null,bounds);
  assert.deepEqual(full,{start:0,end:300});assert.equal(exportVideoTrim(full,bounds),null);
  assert.equal(exportVideoTrim(normalizeVideoTrim({start:0,end:10},bounds),bounds),null);
});
test('trim ends are exclusive and each handle always leaves at least one frame',()=>{
  const bounds=videoTrimBounds(10,30),full=normalizeVideoTrim(null,bounds);
  assert.deepEqual(moveVideoTrim(full,'start',10000,bounds),{start:299,end:300});
  assert.deepEqual(moveVideoTrim(full,'end',-10000,bounds),{start:0,end:1});
  const range={start:30,end:60};assert.deepEqual(exportVideoTrim(range,bounds),{start:1,end:2});
  assert.equal(trimPreviewTime(range,'end',bounds),59/30);
});
test('range normalization handles invalid input, fractional FPS and one-frame clips',()=>{
  const bounds=videoTrimBounds(10.01,30000/1001);
  assert.equal(bounds.frames,300);assert.equal(trimBoundaryTime(300,bounds),10.01);
  assert.equal(trimTimeBoundary(10.01,bounds),300);
  assert.deepEqual(normalizeVideoTrim({start:Infinity,end:NaN},bounds),{start:0,end:1});
  assert.deepEqual(normalizeVideoTrim({start:-500,end:500},bounds),{start:0,end:300});
  const short=videoTrimBounds(.01,30);assert.deepEqual(normalizeVideoTrim(null,short),{start:0,end:1});
  assert.equal(trimPreviewTime({start:0,end:1},'end',short),0);
  assert.deepEqual(videoTrimBounds(NaN,0),{duration:0,fps:30,frames:0});
});
test('all seek previews stay before the last frame boundary',()=>{
  for(const duration of [.01,.1,1,3.37,10.01])for(const fps of [24,29.97,30,60]){
    const bounds=videoTrimBounds(duration,fps);
    for(let start=0;start<bounds.frames;start++)for(const edge of ['start','end']){
      const time=trimPreviewTime({start,end:bounds.frames},edge,bounds);
      assert.ok(time>=0&&time<=Math.max(0,duration-1/fps));
    }
  }
});
test('time formatting carries milliseconds without invalid 60-second fields',()=>{
  assert.equal(formatVideoTrimTime(59.9999),'01:00.000');assert.equal(formatVideoTrimTime(3601.2),'01:00:01.200');assert.equal(formatVideoTrimTime(NaN),'00:00.000');
});
