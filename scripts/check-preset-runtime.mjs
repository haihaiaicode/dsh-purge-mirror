// Read-only real host services + migrated agent-loop request construction.
// No account/model request, app restart, installation or live config writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { registerPromptSections, rewriteLiveAssembly, installHungPromptGlobal } from '../lib/index.js';
import { installAssembleGuard } from '../lib/identity.js';
import { ALL_PATCHES, applyReplacementsToText } from '../lib/core.js';
const base=process.env.PURGE_TEST_HOST;
assert(base,'Explicit PURGE_TEST_HOST required');
const systemPath=path.join(base,'dsh-system-prompt/lib/index.js');
const hostRequire=createRequire(systemPath);
const {Context}=await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')));
const {SystemPrompt,renderPrompt}=await import(pathToFileURL(systemPath));
const source=fs.readFileSync(path.join(base,'dsh-agent-loop/lib/index.js'),'utf8');
const migrated=applyReplacementsToText(source,ALL_PATCHES.find(p=>p.id===87)).text;
assert(!migrated.includes('__dshPurgeHungPrompt()'));
assert(!migrated.includes('dshPurgeHungFn()'));
const start=migrated.indexOf('\t\tconst { assembly } = decision;');
const end=migrated.indexOf('\t\tlet firstAttempt = true;',start);
assert(start>=0&&end>start,'Known official step request-construction body required');
const requestPrompt=new Function('decision','renderPrompt',migrated.slice(start,end)+'\nreturn renderedPrompt;');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'purge-preset-runtime-'));
const oldHome=process.env.DSH_HOME;process.env.DSH_HOME=home;
fs.writeFileSync(path.join(home,'prompt-inject.md'),'ORDINARY RUNTIME SENTINEL');
const cfg={enabled:true,excludePresets:['minimal','roleplay']};
const root=new Context();
const context=(id,child=false)=>({agent:{session:{header:{agentPreset:id,...child?{origin:'subagent',parentSession:'parent'}:{}}}}});
let requests=0;
try {
  await root.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:true,personaPrefix:'NATIVE PERSONA',personaSuffix:'NATIVE SUFFIX'});
  root.systemPrompt.section({name:'workspace:agents-md',order:700,text:'NATIVE WORKSPACE'});
  registerPromptSections(root,cfg);
  root.on('system-prompt/assemble',(a,c,next)=>Promise.resolve(next()).then(b=>rewriteLiveAssembly(cfg,b,c)),{global:true,prepend:true});
  installAssembleGuard(root.systemPrompt,(a,c)=>rewriteLiveAssembly(cfg,a,c));
  const hung=installHungPromptGlobal(cfg);
  async function run(c) {
    const assembly=await root.systemPrompt.assemble(c);
    const prompt=requestPrompt.call(c.agent,{assembly},renderPrompt);
    const excluded=['minimal','roleplay'].includes(c.agent.session.header.agentPreset);
    assert.equal(prompt.includes('ORDINARY RUNTIME SENTINEL'),!excluded);
    if(excluded){assert(prompt.includes('NATIVE PERSONA'));assert(prompt.includes('NATIVE WORKSPACE'));assert(prompt.includes('NATIVE SUFFIX'));}
    assert.equal(Boolean(hung(c)),!excluded);
    requests++;
    return assembly;
  }
  for(const id of ['standard','minimal','standard','roleplay','standard'])await run(context(id));
  await Promise.all(Array.from({length:60},(_,i)=>run(context(['standard','minimal','roleplay'][i%3],i%2===0))));
  // complete:true is restored after the waterfall by the real service. The
  // outer guard must still respect exclusions and not append a fallback.
  root.systemPrompt.section({name:'fixture:complete',order:1,complete:true,text:'NATIVE COMPLETE'});
  const c=context('minimal');const a=await root.systemPrompt.assemble(c);
  const native=new Context();
  try {
    await native.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:true,personaPrefix:'NATIVE PERSONA',personaSuffix:'NATIVE SUFFIX'});
    native.systemPrompt.section({name:'workspace:agents-md',order:700,text:'NATIVE WORKSPACE'});
    native.systemPrompt.section({name:'fixture:complete',order:1,complete:true,text:'NATIVE COMPLETE'});
    assert.equal(requestPrompt.call(c.agent,{assembly:a},renderPrompt),renderPrompt(await native.systemPrompt.assemble(c)));
  } finally { await native.fiber.dispose(); }
  assert.equal(hung(),'', 'old no-context callers are suppressed after opting into exclusions');
  console.log(JSON.stringify({platform:process.platform,hostVersion:JSON.parse(fs.readFileSync(path.join(base,'dsh-agent-loop/package.json'))).version,realCordis:true,realSystemPrompt:true,realStepBody:true,requests,complete:true,parallelAndChildren:true,profile:'temporary',restart:false}));
} finally {
  await root.fiber.dispose();
  delete globalThis.__dshPurgeHungPrompt;
  if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;
  fs.rmSync(home,{recursive:true,force:true});
}
