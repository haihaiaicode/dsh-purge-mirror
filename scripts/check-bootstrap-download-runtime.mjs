// Real official Release, selected Node/Electron runtime, disposable profile only.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { bootstrapInstall } from './bootstrap-install.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'purge-download-acceptance-'));
const profile=path.join(home,'profiles/desktop');fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(path.join(profile,'package.json'),'{}');fs.writeFileSync(path.join(profile,'cordis.patch.yml'),'PRIVATE SETTINGS SENTINEL');
const version=process.argv[2]||'1.6.38';
try {
  for(const fallback of [false,true]) {
    const logs=[];
    const result=await bootstrapInstall({home,cli:process.execPath,version,dryRun:true,
      ...(fallback?{request:async()=>{throw Object.assign(new TypeError('injected fetch-only network failure'),{code:'ENETUNREACH'});}}:{}),
      log:message=>{logs.push(message);console.log(message);},run:async()=>assert.fail('dry run must not invoke installation'),
    });
    assert.equal(result.version,version);assert.equal(result.dryRun,true);
    if(fallback) {
      assert(logs.some(x=>x.includes('stage=archive transport=curl recovered')));
      assert(logs.some(x=>x.includes('stage=checksum transport=curl recovered')));
    }
    assert.equal(fs.readFileSync(path.join(profile,'cordis.patch.yml'),'utf8'),'PRIVATE SETTINGS SENTINEL');
    assert.deepEqual(fs.readdirSync(home),['profiles']);
    console.log(JSON.stringify({platform:process.platform,node:process.versions.node,electron:process.versions.electron||null,version,forcedFallback:fallback,sha256Verified:true,settingsPreserved:true,installed:false}));
  }
} finally {fs.rmSync(home,{recursive:true,force:true});}
