import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadProjectAgentDefinitions, parseRoleMarkdown, resolveRole, discoverRoles, roleSettingsPath, roleProjectSettingsPath, composeRoleConfiguration, canonicalPath, sameFilesystemPath } from '../dist/index.js';
import { selectResourcesByLayers, validateModelAliases } from '../dist/utils.js';
function fixture(t) { const dir=mkdtempSync(join(tmpdir(),'pi-role-core-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {cwd:join(dir,'project'),agentDir:join(dir,'agent'),dir}; }
function put(path,text) { mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);return path; }
test('defaults and predefined prompts are independent and have no model',t=>{
 const f=fixture(t),roles=discoverRoles({...f,projectTrusted:false});
 assert.deepEqual(Object.keys(roles).sort(),['developer','oracle','researcher','reviewer','scout']);
 for(const [name,r] of Object.entries(roles)) { assert.equal(r.model,undefined);assert.equal(r.prompt,parseRoleMarkdown(readFileSync(new URL(`../starter/roles/${name}.md`,import.meta.url),'utf8'),true).prompt); }
 assert.deepEqual(resolveRole(undefined,f).selectorLayers.tools,[undefined,undefined,undefined,undefined]);
 assert.equal(resolveRole(undefined,f).tools,undefined);
});
test('new shared settings compose even with explicit sources and aliases; project alias maps replace',t=>{
 const f=fixture(t);
 put(roleSettingsPath(f.agentDir),JSON.stringify({tools:['!*','read'],skills:['!x'],modelAliases:{a:'p/a:low',b:'p/b:high'},extensionSettings:{shared:{value:1}}}));
 put(roleProjectSettingsPath(f.cwd),JSON.stringify({modelAliases:{},tools:[],extensionSettings:{project:false}}));
 const options={...f,definition:{prompt:'',model:'call',tools:['write'],extensionSettings:{role:[]}},modelAliases:{call:'p/c:medium'},selectorSources:{global:{tools:['grep']},project:{}},resources:{tools:['read','write','grep']},knownModels:new Set(['p/c'])};
 const r=resolveRole('custom',options);
 assert.deepEqual(r.tools,['read','write','grep']);assert.deepEqual(r.model,{provider:'p',model:'c',thinking:'medium'});
 assert.deepEqual(r.extensionSettings,{shared:{value:1},project:false,role:[]});
 assert.deepEqual(composeRoleConfiguration(options).modelAliases,{call:'p/c:medium'});
 assert.throws(()=>resolveRole('custom',{...options,model:'a'}),e=>e.code==='UNKNOWN_MODEL');
 assert.deepEqual(composeRoleConfiguration({...options,projectTrusted:false}).modelAliases,{a:'p/a:low',b:'p/b:high',call:'p/c:medium'});
 assert.deepEqual(resolveRole('custom',{...options,extensionSettings:{}}).extensionSettings,r.extensionSettings);
});
test('selectors are ordered operations, [] and !* differ, candidates are the ceiling',t=>{
 assert.deepEqual(selectResourcesByLayers([[]],['a','b']),['a','b']);
 assert.deepEqual(selectResourcesByLayers([['!*'],[],['a'],['!a','b']],['a','b']),['b']);
 const f=fixture(t);
 assert.deepEqual(resolveRole('custom',{...f,definition:{tools:['!*','read','write']},rootTools:new Set(['read']),tools:['*']}).tools,['read']);
 assert.throws(()=>resolveRole('custom',{...f,definition:{},rootTools:['read'],effectiveTools:['write']}),e=>e.code==='UNKNOWN_TOOL');
});
test('serialized role provenance, symlinks, generic scoped sources and deterministic precedence',t=>{
 const f=fixture(t),low=join(f.dir,'low'),high=join(f.dir,'high');
 put(join(low,'a.md'),'---\nextensions: ["./tool.js"]\n---\nLOW');put(join(high,'a.md'),'HIGH');
 const definitions=discoverRoles({...f,additionalRoleSources:[{path:low,scope:'global',priority:-10}]});
 const clone=JSON.parse(JSON.stringify(definitions));
 assert.deepEqual(resolveRole('a',{...f,definitions:clone}).selectorLayers.extensions[2],[join(low,'tool.js')]);
 const link=join(f.dir,'link');symlinkSync(low,link);
 assert.equal(canonicalPath(link),low);assert.equal(sameFilesystemPath(link,low),true);
 assert.throws(()=>discoverRoles({...f,extensionRoleDirectories:[{path:low,owner:'one'},{path:link,owner:'two'}]}),e=>e.code==='INVALID_METADATA');
 assert.equal(discoverRoles({...f,additionalRoleSources:[{path:high,scope:'project'},{path:low,scope:'global'}],projectTrusted:false}).a.prompt,'LOW');
 assert.equal(discoverRoles({...f,additionalRoleSources:[{path:high,scope:'global',priority:1},{path:low,scope:'global',priority:0}]}).a.prompt,'HIGH');
});
test('strict metadata, JSON validation, alias cycles and effective model override rejection',t=>{
 const f=fixture(t);
 for(const raw of ['---\nmodel: p/m\n---\nx','---\ntools: false\n---\nx','---\noverrideSystemPrompt: 2\n---\nx','---\nextensionSettings: []\n---\nx','---\nfoo: 1']) assert.throws(()=>parseRoleMarkdown(raw,true));
 assert.deepEqual(parseRoleMarkdown('plain'),{prompt:'plain'});
 assert.deepEqual(parseRoleMarkdown('---\nextensionSettings: {"custom":null}\n---\nx').extensionSettings,{custom:null});
 assert.throws(()=>validateModelAliases({a:'b',b:'a'}),e=>e.code==='CONFIG_ERROR');
 const definition={model:'invalid-alias',prompt:'X'};
 assert.deepEqual(resolveRole('custom',{...f,definition,modelOverride:{provider:'p',model:'m'},knownModels:new Set(['p/m'])}).model,{provider:'p',model:'m'});
 assert.throws(()=>resolveRole('custom',{...f,definition,modelOverride:{provider:'p',model:'missing'},knownModels:new Set(['p/m'])}),e=>e.code==='UNKNOWN_MODEL');
 put(roleSettingsPath(f.agentDir),'[]');assert.throws(()=>composeRoleConfiguration(f),e=>e.code==='INVALID_SETTINGS');
});
test('explicit consumer selectors apply after BOTH shared scopes',t=>{
 const f=fixture(t);
 put(roleSettingsPath(f.agentDir),JSON.stringify({tools:['!*','write']}));
 put(roleProjectSettingsPath(f.cwd),JSON.stringify({tools:['!write']}));
 const r=resolveRole(undefined,{...f,selectorSources:{global:{tools:['write']},project:{}},resources:{tools:['read','write']}});
 assert.deepEqual(r.tools,['write']);
 assert.deepEqual(r.selectorLayers.tools,[['!*','write'],['!write'],['write'],undefined,undefined,undefined]);
});
test('effective model overrides supersede blocked role aliases and available-model boundaries are enforced',t=>{
 const f=fixture(t),options={...f,definition:{model:'blocked'},blockedAliases:new Set(['blocked']),knownModels:new Set(['p/m','p/unavailable']),availableModels:new Set(['p/m'])};
 assert.deepEqual(resolveRole('custom',{...options,modelOverride:{provider:'p',model:'m'}}).model,{provider:'p',model:'m'});
 assert.throws(()=>resolveRole('custom',{...options,model:'p/unavailable:high'}),e=>e.code==='UNKNOWN_MODEL');
 assert.throws(()=>resolveRole(undefined,{...f,resources:{tools:['read']},effectiveTools:['write']}),e=>e.code==='UNKNOWN_TOOL');
});
test('all supplied tool ceilings intersect without inventing candidates',t=>{
 const f=fixture(t);
 const boundaries=[
  {rootTools:['read','write'],resources:{tools:['read']}},
  {rootTools:new Set(['read','write']),inheritedTools:['read'],resources:{tools:['read','write']}},
  {rootTools:['read'],inheritedTools:['read','write'],resources:{tools:['read','write']}},
  {inheritedTools:['read','write'],resources:{tools:['read']}},
  {rootTools:['read','write'],inheritedTools:['read','write'],resources:{tools:[]}},
 ];
 for(const boundary of boundaries) {
  const options={...f,...boundary,definition:{tools:['!*','read','write']},tools:['*']};
  assert.deepEqual(resolveRole('custom',options).tools,boundary.resources.tools.length?['read']:[]);
  assert.throws(()=>resolveRole('custom',{...options,effectiveTools:['write']}),e=>e.code==='UNKNOWN_TOOL');
  assert.throws(()=>resolveRole('custom',{...options,tools:['write']}),e=>e.code==='UNKNOWN_TOOL');
 }
 assert.equal(resolveRole(undefined,{...f,tools:['read']}).tools,undefined);
 assert.deepEqual(resolveRole(undefined,{...f,inheritedTools:['read']}).tools,['read']);
 assert.throws(()=>resolveRole(undefined,{...f,resources:{tools:['read']},tools:['write']}),e=>e.code==='UNKNOWN_TOOL');
});
test('captured configuration preserves supplied defaults, aliases and settings across changed or malformed files',t=>{
 const f=fixture(t),globalPath=roleSettingsPath(f.agentDir),projectPath=roleProjectSettingsPath(f.cwd);
 put(globalPath,JSON.stringify({tools:['!*','read'],skills:['!*','kept'],modelAliases:{choice:'p/old:low'},extensionSettings:{shared:true}}));
 put(projectPath,JSON.stringify({tools:['!read'],extensionSettings:{project:1}}));
 const selectorSources={defaults:{global:{tools:['!*','read'],skills:['!*','kept']},project:{}},global:{},project:{}};
 const options={...f,useSharedSettings:false,selectorSources,modelAliases:{choice:'p/frozen:medium'},definition:{model:'choice',extensionSettings:{role:[]}},extensionSettings:{captured:{value:1}},resources:{tools:['read','write'],skills:['kept','other']},knownModels:new Set(['p/frozen','p/old','p/current'])};
 const expected=resolveRole('custom',options);
 assert.deepEqual(expected.tools,['read']);assert.deepEqual(expected.selectedSkills,['kept']);
 assert.deepEqual(expected.model,{provider:'p',model:'frozen',thinking:'medium'});
 assert.deepEqual(expected.extensionSettings,{role:[],captured:{value:1}});
 assert.deepEqual(composeRoleConfiguration(options),{settings:undefined,selectorSources,modelAliases:options.modelAliases});
 put(globalPath,JSON.stringify({tools:['!*','write'],skills:['!*','other'],modelAliases:{choice:'p/current:high'}}));
 put(projectPath,'{}');
 assert.deepEqual(resolveRole('custom',options),expected);
 const live=resolveRole('custom',{...options,useSharedSettings:true,selectorSources:{global:{},project:{}},modelAliases:{}});
 assert.deepEqual(live.tools,['write']);assert.deepEqual(live.model,{provider:'p',model:'current',thinking:'high'});
 put(globalPath,'{ malformed');put(projectPath,'[]');
 assert.deepEqual(resolveRole('custom',options),expected);
 assert.throws(()=>resolveRole('custom',{...options,useSharedSettings:true}),e=>e.code==='INVALID_SETTINGS');
 assert.deepEqual(composeRoleConfiguration({...f,useSharedSettings:false}),{settings:undefined,selectorSources:{global:{},project:{}},modelAliases:{}});
});
test('pure options preserve context combinations, literal prompt modes and namespace overrides for consumers',t=>{
 const f=fixture(t);
 put(roleSettingsPath(f.agentDir),JSON.stringify({extensionSettings:{global:1,replace:'global'}}));
 put(roleProjectSettingsPath(f.cwd),JSON.stringify({extensionSettings:{project:2,replace:'project'}}));
 const definition={prompt:'ROLE',model:'p/role:low',extensionSettings:{role:3,replace:'role'}};
 for(let mask=0;mask<8;mask++) {
  const contextFiles=['global','project','cwd'].filter((_,i)=>mask&(1<<i));
  for(const prompt of ['',join(f.dir,'literal-file'),'CALL']) for(const overrideSystemPrompt of [false,true]) {
   const r=resolveRole('custom',{...f,definition,contextFiles,prompt,overrideSystemPrompt,rootModel:{provider:'p',model:'root'},modelOverride:{provider:'p',model:'override',thinking:'high'},knownModels:new Set(['p/override']),extensionSettings:{call:4,replace:'call'}});
   assert.deepEqual(r.contextFiles,contextFiles);
   assert.deepEqual(r.systemPrompt,{mode:overrideSystemPrompt?'override':'append',text:prompt});
   assert.deepEqual(r.extensionSettings,{global:1,project:2,role:3,call:4,replace:'call'});
   assert.deepEqual(r.model,{provider:'p',model:'override',thinking:'high'});
   assert.deepEqual(structuredClone(r),r); // Consumer-owned capture, not a session snapshot protocol.
  }
 }
 assert.deepEqual(resolveRole('custom',{...f,definition:{prompt:'',contextFiles:['global'],overrideSystemPrompt:true}}).systemPrompt,{mode:'override',text:''});
 assert.deepEqual(resolveRole(undefined,{...f,rootModel:{provider:'p',model:'root'}}).model,{provider:'p',model:'root'});
});
test('pure resolution does not load configured extensions or acquire provider/session resources',t=>{
 const f=fixture(t),extension=put(join(f.agentDir,'extensions','must-not-run.mjs'),"throw new Error('Role resolution executed an extension');");
 put(join(f.agentDir,'settings.json'),JSON.stringify({extensions:[extension]}));
 const before=readFileSync(join(f.agentDir,'settings.json'),'utf8');
 const definitions=discoverRoles(f),composed=composeRoleConfiguration(f);
 const resolved=resolveRole('scout',{...f,definitions});
 assert.ok(resolved.prompt);assert.deepEqual(composed.modelAliases,{});
 assert.equal(readFileSync(join(f.agentDir,'settings.json'),'utf8'),before);
 // Inspect every runtime module reachable from the root, not the separate native launcher.
 const seen=new Set();
 function inspect(name) {
  if(seen.has(name))return;seen.add(name);
  const source=readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:ModelRuntime|SessionManager|AgentSession|DefaultResourceLoader|createAgentSession)\b/,name);
  for(const match of source.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+)\.js["']/g))inspect(match[1]);
 }
 inspect('index');
});
test('project-only definitions scan just project directories with project provenance and legacy < new precedence',t=>{
 const f=fixture(t),role=(text)=>`---\ndescription: ${text}\n---\n${text}`;
 put(join(f.agentDir,'pi-ext-roles/roles/broken.md'),'---\ntools: false\n---\nGLOBAL_MALFORMED');
 const legacy=join(f.cwd,'.pi/legacy/roles');
 put(join(legacy,'shared.md'),role('legacy'));put(join(legacy,'only-legacy.md'),role('legacy only'));
 put(join(f.cwd,'.pi/pi-ext-roles/roles/shared.md'),role('new'));
 const none=loadProjectAgentDefinitions(f.cwd);
 assert.deepEqual(Object.keys(none),['shared']);assert.equal(none.shared.provenance.scope,'project');assert.equal(none.shared.prompt,'new');
 const both=loadProjectAgentDefinitions(f.cwd,[{path:legacy,scope:'project',priority:0}]);
 assert.deepEqual(Object.keys(both).sort(),['only-legacy','shared']);assert.equal(both.shared.prompt,'new');assert.equal(both['only-legacy'].provenance.scope,'project');
 put(join(f.cwd,'.pi/pi-ext-roles/roles/bad.md'),'---\ntools: false\n---\nPROJECT_MALFORMED');
 assert.throws(()=>loadProjectAgentDefinitions(f.cwd),/tools/);
});
