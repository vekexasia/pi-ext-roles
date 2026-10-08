import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { registerRoleContribution, resolveRole, resolveRoleSettings, roleSettingsPath } from '../dist/index.js';
import { registerWorkflowRoles } from '../dist/workflow.js';
function put(path, text) { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, text); }
const models=['p/root','p/role','p/call','p/other'];
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'roles-parity-')),agentDir=join(dir,'agent'),cwd=join(dir,'project');
 mkdirSync(cwd);t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const events=createEventBus();t.after(()=>events.clear());let registration;
 registerWorkflowRoles({events},{registerWorkflowExtension(value){registration=value;}});
 const context={options:{},cwd,agentDir,projectTrusted:true,defaults:{model:{provider:'p',model:'root'},modelAliases:{},selectorSources:{global:{},project:{}},settings:{}},capabilities:{tools:['read','write'],skills:[],extensions:[]},knownModels:new Set(models),availableModels:new Set(models),signal:new AbortController().signal,mode:'execution'};
 const prepare=async(options={},defaults={},extra={})=>{const config={tools:[],skills:[],extensions:[],systemPromptAppend:'',settings:{}};await registration.agentPreparationHooks.roles.prepare(config,{...context,...extra,options,defaults:{...context.defaults,...defaults}});return config;};
 return {dir,cwd,agentDir,events,prepare};
}

test('independent library keeps shared namespace merges, alias order and model-free builtin roles',t=>{
 const f=fixture(t);
 put(roleSettingsPath(f.agentDir),JSON.stringify({extensionSettings:{global:1,both:'global'},modelAliases:{'reviewer-model':'p/role:low'}}));
 put(join(f.cwd,'.pi/pi-ext-roles/settings.json'),JSON.stringify({extensionSettings:{both:'project'}}));
 assert.deepEqual(resolveRoleSettings(f.cwd,true,roleSettingsPath(f.agentDir)).effective.extensionSettings,{global:1,both:'project'});
 const resolved=resolveRole('reviewer',{cwd:f.cwd,agentDir:f.agentDir,rootModel:{provider:'p',model:'root',thinking:'high'},knownModels:new Set(models)});
 assert.deepEqual(resolved.model,{provider:'p',model:'root',thinking:'high'},'library builtin roles do not consume <role>-model aliases');
 assert.deepEqual(resolved.extensionSettings,{global:1,both:'project'});
 const consumer=resolveRole(undefined,{cwd:f.cwd,agentDir:f.agentDir,model:'chosen',modelAliases:{chosen:'p/call:off'},knownModels:new Set(models)});
 assert.deepEqual(consumer.model,{provider:'p',model:'call',thinking:'off'});
 for(const name of ['developer','oracle','researcher','reviewer','scout'])
  assert.doesNotMatch(readFileSync(new URL(`../starter/roles/${name}.md`,import.meta.url),'utf8').split('\n---')[0],/^model:/m,`${name} frontmatter stays model-free`);
});

test('trusted project extensionSettings replaces the whole shared global map in the workflow adapter',async t=>{
 const f=fixture(t);
 put(roleSettingsPath(f.agentDir),JSON.stringify({extensionSettings:{global:1,both:'global'}}));
 put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'---\nextensionSettings: {role: true, both: role}\n---\nROLE');
 assert.deepEqual((await f.prepare()).settings,{global:1,both:'global'},'absent project map keeps global');
 put(join(f.cwd,'.pi/pi-ext-roles/settings.json'),JSON.stringify({extensionSettings:{both:'project'}}));
 assert.deepEqual((await f.prepare()).settings,{both:'project'});
 assert.deepEqual((await f.prepare({},{},{projectTrusted:false})).settings,{global:1,both:'global'},'untrusted project settings are ignored');
 const layered=await f.prepare({role:'custom',extensionSettings:{call:true}},{settings:{consumer:true,both:'consumer'}});
 assert.deepEqual(layered.settings,{both:'role',consumer:true,role:true,call:true},'consumer, role and call namespaces still overlay the project map');
 put(join(f.cwd,'.pi/pi-ext-roles/settings.json'),JSON.stringify({extensionSettings:{}}));
 assert.deepEqual((await f.prepare()).settings,{},'an empty project map is present and replaces global');
});

test('alias layers resolve root dynamic below shared static below consumer static only with dynamic metadata',async t=>{
 const f=fixture(t);
 put(roleSettingsPath(f.agentDir),JSON.stringify({modelAliases:{dyn:'p/role:low',stat:'p/role:low','reviewer-model':'p/role:low',shared:'p/other:off'}}));
 const modelAliases=Object.freeze({dyn:'p/root','reviewer-model':'p/root',stat:'p/call:high'});
 const layered={modelAliases,dynamicModelAliasNames:Object.freeze(['dyn','reviewer-model'])};
 assert.equal((await f.prepare({model:'dyn'},layered)).model,'p/role:low','shared static beats root dynamic');
 assert.equal((await f.prepare({model:'stat'},layered)).model,'p/call:high','consumer static beats shared static');
 assert.equal((await f.prepare({model:'shared'},layered)).model,'p/other:off');
 assert.equal((await f.prepare({role:'reviewer',model:'reviewer-model'},layered)).model,'p/role:low');
 assert.equal((await f.prepare({role:'reviewer'},layered)).model,'p/role:low','builtin default alias uses the layered winner');
 assert.equal((await f.prepare({model:'dyn'},{modelAliases})).model,'p/root','without metadata every consumer alias keeps precedence');
 assert.equal((await f.prepare({role:'reviewer'},{modelAliases})).model,undefined,'no dynamic guess from the <role>-model name');
 await assert.rejects(f.prepare({},{modelAliases,dynamicModelAliasNames:'dyn'}),/dynamicModelAliasNames/);
});

test('builtin roles default to an available <role>-model alias only without explicit or role models',async t=>{
 const f=fixture(t);
 const defaults={modelAliases:{'reviewer-model':'p/role:low','scout-model':'p/other:off','custom-model':'p/other:off'}};
 put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'CUSTOM');
 assert.equal((await f.prepare({role:'reviewer'},defaults)).model,'p/role:low');
 assert.equal((await f.prepare({role:'scout'},defaults)).model,'p/other:off');
 assert.equal((await f.prepare({role:'reviewer',model:'p/call:off'},defaults)).model,'p/call:off','explicit call model wins');
 assert.equal((await f.prepare({role:'developer'},defaults)).model,undefined,'absent alias inherits root');
 assert.equal((await f.prepare({role:'developer'},{...defaults,model:{provider:'p',model:'root',thinking:'high'}})).model,'p/root:high');
 assert.equal((await f.prepare({role:'custom'},defaults)).model,undefined,'custom roles never consume <role>-model');
 assert.equal((await f.prepare({},defaults)).model,undefined);
 put(join(f.agentDir,'pi-ext-roles/roles/reviewer.md'),'GLOBAL OVERRIDE');
 assert.equal((await f.prepare({role:'reviewer'},defaults)).model,undefined,'overridden builtin roles are custom roles');
 put(join(f.cwd,'.pi/pi-ext-roles/roles/scout.md'),'---\nmodel: p/call:low\n---\nPROJECT OVERRIDE');
 assert.equal((await f.prepare({role:'scout'},defaults)).model,'p/call:low','role-defined model wins');
 await assert.rejects(f.prepare({role:'oracle'},{modelAliases:{'oracle-model':'p/missing:off'}}),/Unknown model/);
});

test('builtin default aliases keep root thinking for the same physical model',async t=>{
 const f=fixture(t),model={provider:'p',model:'root',thinking:'high'};
 assert.equal((await f.prepare({role:'reviewer'},{model,modelAliases:{'reviewer-model':'p/root'}})).model,'p/root:high');
 assert.equal((await f.prepare({role:'reviewer'},{model:{provider:'p',model:'root'},modelAliases:{'reviewer-model':'p/root'}})).model,undefined);
 assert.equal((await f.prepare({role:'reviewer'},{model,modelAliases:{'reviewer-model':'p/root:low'}})).model,'p/root:low');
 assert.equal((await f.prepare({role:'reviewer'},{model,modelAliases:{'reviewer-model':'p/role'}})).model,'p/role','other physical models keep alias thinking');
});

test('worktree agents discover roles and shared settings from the launch project, selectors from execution cwd',async t=>{
 const f=fixture(t),worktree=join(f.dir,'worktree');
 put(join(f.cwd,'.pi/pi-ext-roles/roles/launch.md'),'---\ntools: [write]\n---\nLAUNCH');
 put(join(f.cwd,'.pi/pi-ext-roles/settings.json'),JSON.stringify({tools:['!*','read'],extensions:['./shared.mjs'],extensionSettings:{from:'launch'},modelAliases:{chosen:'p/role:low'}}));
 put(join(worktree,'.pi/pi-ext-roles/roles/stale.md'),'STALE');
 put(join(worktree,'.pi/pi-ext-roles/settings.json'),JSON.stringify({extensionSettings:{from:'worktree'}}));
 const extra={cwd:worktree,projectCwd:f.cwd};
 const config=await f.prepare({role:'launch',model:'chosen',extensions:['./call.mjs']},{},extra);
 assert.equal(config.systemPromptAppend,'LAUNCH');assert.equal(config.model,'p/role:low');
 assert.deepEqual(config.tools,['!*','read','write']);assert.deepEqual(config.settings,{from:'launch'});
 assert.deepEqual(config.extensions,[join(f.cwd,'.pi/pi-ext-roles/shared.mjs'),join(worktree,'call.mjs')],'shared-settings selectors stay relative to their launch-project file, call selectors to the execution cwd');
 await assert.rejects(f.prepare({role:'stale'},{},extra),/Unknown agent role: stale/);
 assert.deepEqual((await f.prepare({},{},{cwd:worktree})).settings,{from:'worktree'},'without projectCwd discovery stays on cwd');
 await assert.rejects(f.prepare({},{},{projectCwd:42}),/projectCwd/);
});

test('only the packaged fallback role files consume <role>-model, not contributions that declare a builtin scope',async t=>{
 const f=fixture(t),roles=join(f.dir,'contributed'),handlers=new Map();
 put(join(roles,'auditor.md'),'CONTRIBUTED_BUILTIN');
 registerRoleContribution({events:f.events,on(name,handler){handlers.set(name,handler);return()=>handlers.delete(name);}},{owner:join(f.dir,'contributor.mjs'),roleDirectories:[{path:roles,scope:'builtin'}]});
 handlers.get('session_start')();
 const defaults={modelAliases:{'auditor-model':'p/role:low','reviewer-model':'p/role:low'}};
 const contributed=await f.prepare({role:'auditor'},defaults);
 assert.equal(contributed.systemPromptAppend,'CONTRIBUTED_BUILTIN');
 assert.equal(contributed.model,undefined,'a contribution with builtin scope is not a packaged fallback');
 assert.equal((await f.prepare({role:'reviewer'},defaults)).model,'p/role:low');
});

test('fallback default alias: present-but-unavailable fails, absent inherits root including thinking and virtual root models',async t=>{
 const f=fixture(t);
 await assert.rejects(f.prepare({role:'reviewer'},{modelAliases:{'reviewer-model':'p/missing:off'}}),error=>error.code==='UNKNOWN_MODEL');
 assert.equal((await f.prepare({role:'reviewer'},{model:{provider:'p',model:'root',thinking:'high'}})).model,'p/root:high','absent alias keeps the root thinking');
 assert.equal((await f.prepare({role:'reviewer'},{model:{provider:'p',model:'root'}})).model,undefined,'absent alias leaves an implicit root model to the consumer');
 // A virtual workflow/<alias> root passes through unchanged; the consumer maps it to its physical target.
 assert.equal((await f.prepare({role:'reviewer'},{model:{provider:'workflow',model:'cheap',thinking:'high'},modelAliases:{cheap:'p/root'}},{knownModels:new Set([...models,'workflow/cheap']),availableModels:new Set([...models,'workflow/cheap'])})).model,'workflow/cheap:high');
});

test('the workflow adapter reports an unknown role as invalid agent metadata, while the library keeps its own code',async t=>{
 const f=fixture(t);
 await assert.rejects(f.prepare({role:'reviwer'}),error=>error.code==='INVALID_METADATA'&&error.message==='Unknown agent role: reviwer');
 assert.throws(()=>resolveRole('reviwer',{cwd:f.cwd,agentDir:f.agentDir}),error=>error.code==='UNKNOWN_AGENT_TYPE');
});

test('the adapter registration carries the extension entry source so consumers can prove it loaded',()=>{
 const events=createEventBus();let registration;
 registerWorkflowRoles({events},{registerWorkflowExtension(value){registration=value;}},'file:///extension/src/extension.ts');
 events.clear();
 assert.equal(registration.source,'file:///extension/src/extension.ts');
 let unsourced;registerWorkflowRoles({events},{registerWorkflowExtension(value){unsourced=value;}});
 assert.equal(Object.hasOwn(unsourced,'source'),false);
 assert.match(readFileSync(new URL('../src/extension.ts',import.meta.url),'utf8'),/registerWorkflowRoles\(api, registry, import\.meta\.url\);/);
});
