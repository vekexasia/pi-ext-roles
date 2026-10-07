import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { registerRoleContribution, resolveRole, loadRole, discoverRoles } from '../dist/index.js';
import { registerWorkflowRoles } from '../dist/workflow.js';
function put(path, text) { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, text); }
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'roles-adapter-')),agentDir=join(dir,'agent'),cwd=join(dir,'project');
 mkdirSync(cwd);t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const events=createEventBus();t.after(()=>events.clear());let registration;
 registerWorkflowRoles({events},{registerWorkflowExtension(value){registration=value;}});
 const context={options:{},cwd,agentDir,projectTrusted:false,defaults:{model:{provider:'p',model:'root'},modelAliases:{},selectorSources:{global:{},project:{}},settings:{}},capabilities:{tools:['read','write','grep'],skills:['global','consumer','role','call'],extensions:['builtin:kept']},knownModels:new Set(['p/root','p/role','p/call']),availableModels:new Set(['p/root','p/role','p/call']),signal:new AbortController().signal,mode:'execution'};
 const configuration=()=>({tools:[],skills:[],extensions:[],systemPromptAppend:'EXISTING',settings:{}});
 const prepare=async(options={},defaults={},base={})=>{const config={...configuration(),...base};await registration.agentPreparationHooks.roles.prepare(config,{...context,options,defaults:{...context.defaults,...defaults}});return config;};
 return {dir,cwd,agentDir,events,context,registration,prepare};
}
test('registration exposes only the optional role schema and generic preparation',t=>{
 const f=fixture(t);assert.equal(f.registration.version,'0.1.3');assert.equal(f.registration.headline,'Pi roles');
 assert.deepEqual(f.registration.agentPreparationHooks.roles.optionsSchema,{type:'object',properties:{role:{type:'string',minLength:1}},additionalProperties:true});
});
test('inherited models without thinking remain implicit for calls without a role and model-free roles',async t=>{
 const f=fixture(t);
 put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'CUSTOM');
 const model=Object.freeze({provider:'p',model:'root'});
 for(const role of [undefined,'developer','oracle','researcher','reviewer','scout','custom']) {
  const config=await f.prepare(role===undefined?{}:{role},{model});
  assert.equal(config.model,undefined,`${role??'no role'} must preserve the implicit consumer model`);
 }
 assert.deepEqual(model,{provider:'p',model:'root'});
 assert.equal((await f.prepare({}, {model:{...model,thinking:'low'}})).model,'p/root:low');
});
test('call and role aliases without thinking become physical models without rewriting the original options',async t=>{
 const f=fixture(t);
 put(join(f.agentDir,'pi-ext-roles/settings.json'),JSON.stringify({modelAliases:{shared:'p/role',chosen:'p/role'}}));
 put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'---\nmodel: shared\n---\nROLE');
 const defaults=Object.freeze({model:Object.freeze({provider:'p',model:'root',thinking:'high'}),modelAliases:Object.freeze({chosen:'p/call'})});
 for(const role of [undefined,'custom']) {
  const options=Object.freeze({...(role===undefined?{}:{role}),model:'chosen'});
  assert.equal((await f.prepare(options,defaults)).model,'p/call');
  assert.equal(options.model,'chosen','core recovery must still see the original alias');
  assert.equal((await f.prepare({...options,model:'chosen:off'},defaults)).model,'p/call:off');
 }
 assert.equal((await f.prepare({model:'shared'},defaults)).model,'p/role');
 assert.equal((await f.prepare({role:'custom'},defaults)).model,'p/role');
 assert.deepEqual(defaults.modelAliases,{chosen:'p/call'});
 await assert.rejects(f.prepare({model:'p/call'},defaults),/must be provider\/model:thinking/);
});
test('shared defaults, consumer layers, role and call precedence use physical models and complete selectors',async t=>{
 const f=fixture(t);
 put(join(f.agentDir,'pi-ext-roles/settings.json'),JSON.stringify({modelAliases:{chosen:'p/role:low'},tools:['!*','read'],skills:['!*','global'],extensionSettings:{shared:1,replace:'shared'}}));
 put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'---\nmodel: chosen\ntools: [write]\nskills: [role]\nextensions: ["./owned.mjs"]\ncontextFiles: [global]\nextensionSettings: {replace: role, role: true}\n---\nROLE');
 const options=Object.freeze({role:'custom',tools:['grep'],skills:['call'],model:'p/call:high',contextFiles:[],extensionSettings:{replace:'call',call:true},label:'Explicit'});
 const defaults={selectorSources:{global:{tools:['!read'],skills:['consumer']},project:{}},settings:{replace:'consumer',consumer:true}};
 const config=await f.prepare(options,defaults,{label:'Explicit'});
 assert.equal(config.model,'p/call:high');assert.deepEqual(config.tools,['!*','read','!read','write','grep']);
 assert.deepEqual(config.skills,['!*','global','consumer','role','call']);
 assert.deepEqual(config.extensions,[join(f.agentDir,'pi-ext-roles/roles/owned.mjs')]);
 assert.deepEqual(config.contextFiles,[]);assert.equal(config.label,'Explicit');assert.equal(config.systemPrompt,undefined);assert.equal(config.systemPromptAppend,'ROLE\n\nEXISTING');
 assert.deepEqual(config.settings,{shared:1,replace:'call',consumer:true,role:true,call:true});
 assert.deepEqual(options.tools,['grep']);
 const role=await f.prepare({role:'custom'},defaults);assert.equal(role.model,'p/role:low');assert.equal(role.label,'custom');assert.equal(role.settings.replace,'role');
});
test('shared settings apply without a role; trust is explicit and call overrides an unavailable role model',async t=>{
 const f=fixture(t);
 put(join(f.agentDir,'pi-ext-roles/settings.json'),JSON.stringify({tools:['!*','read'],extensionSettings:{global:true}}));
 put(join(f.cwd,'.pi/pi-ext-roles/settings.json'),'MALFORMED');
 put(join(f.cwd,'.pi/pi-ext-roles/roles/broken.md'),'---\ntools: false\n---\nx');
 assert.deepEqual((await f.prepare()).tools,['!*','read']);assert.deepEqual((await f.prepare()).settings,{global:true});
 put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'---\nmodel: p/unavailable:low\n---\nROLE');
 assert.equal((await f.prepare({role:'custom',model:'p/call:off'})).model,'p/call:off');
 await assert.rejects(f.prepare({role:'custom'}),/Unknown model/);
 assert.throws(()=>f.registration.agentPreparationHooks.roles.prepare({tools:[],skills:[],extensions:[],systemPromptAppend:'',settings:{}},{...f.context,projectTrusted:true}),/settings/);
});
test('role override uses base channel, preserves append, and explicit call base wins',async t=>{
 const f=fixture(t);put(join(f.agentDir,'pi-ext-roles/roles/custom.md'),'---\noverrideSystemPrompt: true\ncontextFiles: []\n---\nBASE');
 const config=await f.prepare({role:'custom'});assert.equal(config.systemPrompt,'BASE');assert.equal(config.systemPromptAppend,'EXISTING');
 const explicit=await f.prepare({role:'custom',systemPrompt:'CALL'});assert.equal(explicit.systemPrompt,'CALL');assert.equal(explicit.systemPromptAppend,'EXISTING');
 const empty=await f.prepare({role:'custom',systemPrompt:''});assert.equal(empty.systemPrompt,'');
 const appended=await f.prepare({role:'custom',systemPromptAppend:'CALL_APPEND'});assert.equal(appended.systemPromptAppend,'CALL_APPEND');
 await assert.rejects(f.prepare({role:'custom',systemPrompt:42}),/systemPrompt must be a string/);
 await assert.rejects(f.prepare({role:'custom',systemPromptAppend:42}),/systemPromptAppend must be a string/);
});
test('contributions are collected from this bus only after actual activation',async t=>{
 const f=fixture(t),owner=join(f.dir,'contributor.mjs'),roles=join(f.dir,'roles'),handlers=new Map();
 put(join(roles,'external.md'),'EXTERNAL');
 registerRoleContribution({events:f.events,on(name,handler){handlers.set(name,handler);return()=>handlers.delete(name);}},{owner,roleDirectories:[roles]});
 await assert.rejects(f.prepare({role:'external'}),/Unknown agent role/);
 handlers.get('session_start')();assert.equal((await f.prepare({role:'external'})).systemPromptAppend,'EXTERNAL\n\nEXISTING');
 handlers.get('session_shutdown')();await assert.rejects(f.prepare({role:'external'}),/Unknown agent role/);
});
test('semantic role names reject dangerous names in library entry points and discovery',t=>{
 const f=fixture(t);
 for(const role of ['', ' reviewer', 'reviewer ', '.', '..', '../reviewer', 'a/b', 'a\\b', '__proto__', 'constructor', 'prototype']) {
  assert.throws(()=>resolveRole(role,{...f.context,definition:{prompt:'x'}}),/Invalid role name/);
  assert.throws(()=>loadRole(role,f.context),/Invalid role name/);
 }
 for(const role of ['toString','hasOwnProperty']) {assert.throws(()=>resolveRole(role,{...f.context,definitions:{}}),/Unknown agent role/);assert.throws(()=>loadRole(role,f.context),/Unknown agent role/);}
 put(join(f.agentDir,'pi-ext-roles/roles/constructor.md'),'BAD');assert.throws(()=>discoverRoles(f.context),/Invalid role name/);
});
test('the five model-free fallback roles exist without any registered contribution',t=>{
 const f=fixture(t);assert.deepEqual(Object.keys(discoverRoles({...f.context,extensionRoleDirectories:[]})).sort(),['developer','oracle','researcher','reviewer','scout']);
});
