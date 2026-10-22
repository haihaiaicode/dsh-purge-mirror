// Disposable official npm host: baseline -> candidate -> rollback -> failure recovery.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const fixture=process.env.PURGE_TEST_NPM_ROOT;
if(!fixture||!fs.existsSync(path.join(fixture,'.purge-test-only')))throw Error('Explicit isolated host marker required');
const host=path.join(fixture,'node_modules/@deepseek-ai/dsh');
const cli=path.join(host,'lib/bin.js');
const requireHost=createRequire(path.join(host,'package.json'));
const base=path.dirname(path.dirname(path.dirname(requireHost.resolve('@deepseek-ai/dsh-app-boot'))));
assert(fs.realpathSync(base).startsWith(fs.realpathSync(fixture)+path.sep),'Host components must stay inside the isolated installation');
const [baseline,candidate]=process.argv.slice(2).map(p=>path.resolve(p));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'purge-official-install-'));
const home=path.join(temp,'home');fs.mkdirSync(home);
const env={...process.env,DSH_HOME:home,DSH_PROFILE:'web',DSH_SURFACE:'web',PURGE_DSH_CLI:cli,DSH_BASE:'',PURGE_PROFILE_DIR:'',PURGE_TEST_HOME:home,PURGE_TEST_PROFILE:'web',PURGE_TEST_HOST:base};
try {
  execFileSync(process.execPath,[fileURLToPath(new URL('./check-cordis-composition.mjs',import.meta.url))],{env,stdio:'inherit'});
  execFileSync(process.execPath,[fileURLToPath(new URL('./check-preset-runtime.mjs',import.meta.url))],{env,stdio:'inherit'});
  execFileSync(process.execPath,[cli,'--profile','web','--dump-default-config'],{env,stdio:'pipe',timeout:120000,maxBuffer:4e6});
  const config=path.join(home,'profiles/web/cordis.patch.yml');fs.appendFileSync(config,'\n# PRIVATE CONFIG SENTINEL\n');
  const prompt=path.join(home,'prompt-inject.md');fs.writeFileSync(prompt,'PRIVATE PROMPT SENTINEL');
  const before=fs.readFileSync(config);
  execFileSync(process.execPath,[fileURLToPath(new URL('./verify-rollback-runtime.mjs',import.meta.url)),baseline,candidate],{env,stdio:'inherit',timeout:600000});
  assert.deepEqual(fs.readFileSync(config),before);assert.equal(fs.readFileSync(prompt,'utf8'),'PRIVATE PROMPT SENTINEL');
  console.log(JSON.stringify({platform:process.platform,realOfficialHost:true,upgradeRollbackAndRecovery:true,configPreserved:true,promptPreserved:true,restart:false}));
} catch (error) {
  const logs=path.join(home,'profiles/web/.plugin-manager/logs');
  if(fs.existsSync(logs)) for(const dir of fs.readdirSync(logs).slice(-8)) {
    const file=path.join(logs,dir,'pnpm.log');
    if(fs.existsSync(file)) console.error(`Isolated package-manager log ${dir}:\n${fs.readFileSync(file,'utf8').slice(-6000)}`);
  }
  if(process.platform === 'win32') {
    // Replay only inside this disposable fixture: the host suppresses pnpm output.
    const restored=path.join(home,'dsh-purge-community/restored');
    for(const stage of fs.existsSync(restored)?fs.readdirSync(restored):[]) {
      const archive=path.join(restored,stage,'dsh-purge-community/dsh-purge-community.tgz');
      if(!fs.existsSync(archive))continue;
      try {
        const output=execFileSync(process.execPath,[path.join(fixture,'node_modules/pnpm/bin/pnpm.cjs'),'add',archive,'--reporter=ndjson'],{cwd:path.join(home,'profiles/web'),env,timeout:120000,encoding:'utf8',maxBuffer:4e6});
        console.error('Direct isolated pnpm replay succeeded:',output.slice(-12000));
      } catch(replay) {console.error('Direct isolated pnpm replay:',String(replay.stdout||'').slice(-16000),String(replay.stderr||'').slice(-8000));}
    }
  }
  throw error;
} finally {fs.rmSync(temp,{recursive:true,force:true});}
