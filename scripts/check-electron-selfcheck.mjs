/** Runs Electron's real ASAR shim against disposable archives; does not start/restart DSH. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.PURGE_ELECTRON_EXEC || "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness";
if (!fs.existsSync(binary)) throw Error("Set PURGE_ELECTRON_EXEC to an Electron binary; this test is not a Node simulation");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "purge-electron-")));
try {
  const resources = path.join(tmp, "Example.app/Contents/Resources");
  fs.mkdirSync(path.join(resources, "app/dsh/node_modules/@deepseek-ai"), { recursive: true });
  const json = Buffer.from('{"files":{}}'), padded = Math.ceil(json.length / 4) * 4;
  const archive = Buffer.alloc(16 + padded);
  archive.writeUInt32LE(4, 0); archive.writeUInt32LE(8 + padded, 4);
  archive.writeUInt32LE(4 + padded, 8); archive.writeUInt32LE(json.length, 12); json.copy(archive, 16);
  fs.writeFileSync(path.join(resources, "app.asar"), archive);
  const home = path.join(tmp, "home"), profile = path.join(home, "profiles/desktop");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "package.json"), "{}");
  fs.writeFileSync(path.join(profile, "cordis.patch.yml"), "defaultPreset: workspace-write\n");
  const source = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import {createRequire} from 'node:module';
    const disk = createRequire(import.meta.url)('original-fs');
    const {hostLayoutLayer,selfCheck} = await import(process.env.PURGE_TEST_MODULE);
    assert(process.versions.electron, 'must run actual Electron');
    const resources=process.env.PURGE_TEST_RESOURCES, host=resources+'/app/dsh/node_modules/@deepseek-ai', archive=resources+'/app.asar';
    const before=process.noAsar;
    if (process.env.PURGE_TEST_PHASE === 'sealed') {
    assert.equal(fs.statSync(archive).isFile(),false,'reproduce ASAR virtual-directory behavior');
    assert.equal(disk.statSync(archive).isFile(),true);
    assert.equal(hostLayoutLayer(host).broken[0].status,'sealed');
    assert.equal(process.noAsar,before,'no global noAsar mutation');
    console.log(JSON.stringify({electron:process.versions.electron,sealed:'broken'}));
    } else {
    // ASAR roots are cached by Electron; use a fresh path for the missing-archive reproduction.
    const missingResources=resources+'/Missing.app/Contents/Resources';
    const missingHost=missingResources+'/app/dsh/node_modules/@deepseek-ai';
    disk.mkdirSync(missingHost,{recursive:true});
    assert.throws(()=>fs.statSync(missingResources+'/app.asar'), /Invalid package/);
    assert.equal(hostLayoutLayer(missingHost).state,'ok');
    assert.equal(hostLayoutLayer(host).state,'ok');
    const report=await selfCheck(host,process.env.DSH_HOME,{env:{DSH_PROFILE:'desktop'},argv:[],coreModule:{ALL_PATCHES:[],patchStatus:async()=>({})}});
    assert.equal(report.layers.find(l=>l.kind==='layout').state,'ok','route-equivalent selfCheck must not override diskFs');
    assert.equal(hostLayoutLayer(host,{statSync(){throw Object.assign(Error('denied'),{code:'EACCES'})}}).broken[0].status,'unreadable');
    assert.equal(process.noAsar,before,'no global noAsar mutation');
    console.log(JSON.stringify({electron:process.versions.electron,sealed:'broken',missing:'ok',selfCheck:'ok',permission:'unreadable',globalNoAsarUnchanged:true}));
    }
  `;
  for (const phase of ["sealed", "unpacked"]) {
    // Windows holds the ASAR open for the Electron process lifetime.
    // Delete only our disposable fixture after the first test process has exited.
    if (phase === "unpacked") fs.unlinkSync(path.join(resources, "app.asar"));
    const out = execFileSync(binary, ["--input-type=module", "-e", source], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DSH_HOME: home, PURGE_TEST_PHASE: phase,
        PURGE_TEST_MODULE: pathToFileURL(path.join(root, "lib/selfcheck.js")).href, PURGE_TEST_RESOURCES: resources },
      encoding: "utf8", timeout: 30000,
    });
    console.log(out.trim());
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
