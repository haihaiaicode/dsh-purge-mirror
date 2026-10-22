// Run only in disposable Linux CI as root. All writes stay inside a fresh temp dir.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
if(process.platform!=='linux'||process.getuid()!==0)throw Error('Linux root isolation test required');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'purge-root-audit-'));
fs.chmodSync(tmp,0o755);
const module=path.join(tmp,'audit.mjs');fs.copyFileSync(new URL('../lib/audit.js',import.meta.url),module);fs.chmodSync(module,0o644);
const uid=65534,gid=65534;
const child=(home,root=false,event='test',extra={})=>execFileSync(process.execPath,['--input-type=module','-e',`import {logAudit,readAudit} from ${JSON.stringify('file://'+module)};if(!logAudit(${JSON.stringify(event)}, {}, process.env.DSH_HOME))process.exit(3);console.log(JSON.stringify(readAudit({home:process.env.DSH_HOME})));`],{uid:root?0:uid,gid:root?0:gid,env:{PATH:process.env.PATH,DSH_HOME:home,...extra},encoding:'utf8'});
try {
  for(const legacy of [false,true]) {
    const home=path.join(tmp,legacy?'legacy':'new');fs.mkdirSync(home,{mode:0o700});fs.chownSync(home,uid,gid);
    const sentinel=path.join(home,'config');fs.writeFileSync(sentinel,'PRIVATE',{mode:0o600});fs.chownSync(sentinel,uid,gid);
    const dir=path.join(home,'dsh-purge-community'),file=path.join(dir,'audit.jsonl');
    if(legacy){fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(file,'{"event":"old"}\n',{mode:0o600});fs.writeFileSync(file+'.1','history',{mode:0o600});}
    child(home,true,'root-apply');
    assert.equal(fs.statSync(dir).uid,uid);assert.equal(fs.statSync(dir).mode&0o777,0o700);
    assert.equal(fs.statSync(file).uid,uid);assert.equal(fs.statSync(file).mode&0o777,0o600);
    let rows=JSON.parse(child(home,false,'user-action'));assert(rows.some(r=>r.event==='root-apply'));
    if(legacy){assert(rows.some(r=>r.event==='old'));assert.equal(fs.statSync(file+'.1').uid,uid);}
    fs.appendFileSync(file,'x'.repeat(1024*1024+1));
    child(home,true,'root-rotate');child(home,false,'user-after-rotation');
    for(const p of [file,file+'.1'])assert.equal(fs.statSync(p).uid,uid);
    assert.equal(fs.readFileSync(sentinel,'utf8'),'PRIVATE');assert.equal(fs.statSync(sentinel).mode&0o777,0o600);
  }
  // Root-owned volume: explicit UID/GID resolves ambiguity, no guess at user names.
  const volume=path.join(tmp,'volume');fs.mkdirSync(volume,{mode:0o755});
  child(volume,true,'volume-root',{PURGE_AUDIT_UID:String(uid),PURGE_AUDIT_GID:String(gid)});
  child(volume,false,'volume-user');
  // A privileged writer must not chown or write external symlink/hardlink targets.
  const home=path.join(tmp,'links');fs.mkdirSync(home);fs.chownSync(home,uid,gid);
  const outside=path.join(tmp,'outside');fs.mkdirSync(outside);
  const dir=path.join(home,'dsh-purge-community');fs.symlinkSync(outside,dir);
  assert.throws(()=>child(home,true));assert.equal(fs.statSync(outside).uid,0);assert.deepEqual(fs.readdirSync(outside),[]);
  fs.unlinkSync(dir);fs.mkdirSync(dir,{mode:0o700});
  const target=path.join(outside,'secret');fs.writeFileSync(target,'PRIVATE',{mode:0o600});
  for(const link of ['symlinkSync','linkSync']){fs[link](target,path.join(dir,'audit.jsonl'));assert.throws(()=>child(home,true));fs.unlinkSync(path.join(dir,'audit.jsonl'));assert.equal(fs.statSync(target).uid,0);assert.equal(fs.readFileSync(target,'utf8'),'PRIVATE');}
  console.log(JSON.stringify({actualRootAndUnprivileged:true,newAndLegacy:true,rotation:true,privateModesPreserved:true,explicitContainerOwner:true,linkTargetsUntouched:true}));
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
