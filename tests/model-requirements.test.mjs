import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['shared/model-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {requiredModelIds}=module.exports;
test('fast RGB/material approximations need no downloads; normals reuse the selected built-in depth model',()=>{
  const fast={model:'image-small',processingMode:'fast',maps:['source','basecolor','roughness','metallic','specular']};
  assert.deepEqual(requiredModelIds(fast),[]);
  assert.deepEqual(requiredModelIds({...fast,maps:['normal','depth']}),['image-small']);
  assert.deepEqual(requiredModelIds({...fast,maps:['alpha']}),['alpha-fast']);
});
test('advanced material channels share appearance while normal/alpha require distinct prepared models',()=>{
  const advanced={model:'video-small',processingMode:'advanced',maps:['source','basecolor','roughness','metallic','specular','normal','alpha','depth']};
  assert.deepEqual(requiredModelIds(advanced),['appearance','normal','alpha-advanced','video-small']);
  assert.deepEqual(requiredModelIds(advanced,['source']),[]);
});
