// Actual host composition function; pure data only, no plugin/model/app startup.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {parse} from 'yaml';
const base=process.env.PURGE_TEST_HOST;
if(!base)throw Error('Explicit host component directory required');
const {composeEntries}=await import(pathToFileURL(path.join(base,'dsh-app-boot/lib/index.js')).href);
const patches=parse(fs.readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8'),{logLevel:'silent'});
const insertion=patches.find(p=>p.insert?.some(r=>r.id==='dsh-purge'));
assert(insertion);assert(!patches.some(p=>p.id==='dsh-purge'&&!p.insert));
const freshWarnings=[];
const fresh=composeEntries([patches],m=>freshWarnings.push(m));
assert(!freshWarnings.some(m=>m.includes('"dsh-purge"')));
assert.deepEqual(fresh.find(p=>p.id==='dsh-purge').inject,['systemPrompt','tools']);
assert.equal(fresh.filter(p=>p.id==='dsh-purge').length,1);
// An existing custom row is not silently rewritten by the bundle's compatibility patch.
const old={id:'dsh-purge',name:'custom-fixture',inject:['customService'],config:{private:true}};
const oldBytes=JSON.stringify(old);
const upgraded=composeEntries([[{insert:[old]}],patches]);
assert.equal(JSON.stringify(old),oldBytes);
assert.deepEqual(upgraded.find(p=>p.name==='custom-fixture'),old);
// Later user configuration and re-composition retain precedence.
const override={id:'dsh-purge',config:{enabled:false,private:'sentinel'}};
const result=composeEntries([patches,[override]]);
assert.deepEqual(result.find(p=>p.id==='dsh-purge').config,override.config);
assert.deepEqual(composeEntries([patches,[override]]),result);
console.log(JSON.stringify({realComposeEntries:true,freshInstall:true,legacyEntryPreserved:true,userOverride:true,recomposition:true,unrelatedWarningsVisible:freshWarnings.length>0}));
