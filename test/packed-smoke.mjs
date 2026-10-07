import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'pi-role-packed-'));
try {
 const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 assert.equal(manifest.peerDependencies['@earendil-works/pi-coding-agent'],'*');
 assert.equal(manifest.dependencies['@earendil-works/pi-coding-agent'],undefined);
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],{cwd:root,encoding:'utf8'}))[0];
 for(const path of ['README.md','LICENSE','RELEASING.md','docs/roles.md','dist/index.d.ts','dist/launcher.d.ts','src/extension.ts','src/cli-tool-bridge.ts','dist/cli-tool-bridge.js',...['developer','oracle','researcher','reviewer','scout'].map(n=>`starter/roles/${n}.md`)])assert.ok(packed.files.some(f=>f.path===path),path);
 assert.equal(manifest.exports['./pi'],undefined);
 for(const path of ['src/pi.ts','dist/pi.js','dist/pi.d.ts']) assert.ok(!packed.files.some(f=>f.path===path),path);
 for(const name of ['a','b']) {
  const prefix=join(dir,name);mkdirSync(prefix);writeFileSync(join(prefix,'package.json'),'{"type":"module","private":true}');
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','@earendil-works/pi-coding-agent@1.0.0',join(dir,packed.filename)],{cwd:prefix,stdio:'pipe'});
 }
 const pathA=join(dir,'a/node_modules/@piewf/pi-ext-roles'),pathB=join(dir,'b/node_modules/@piewf/pi-ext-roles');
 const a=await import(pathToFileURL(join(pathA,'dist/index.js'))),b=await import(pathToFileURL(join(pathB,'dist/index.js')));
 const pi=await import(pathToFileURL(join(dir,'a/node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
 const bus=pi.createEventBus(),owner=join(dir,'owner.js'),roles=join(dir,'roles');mkdirSync(roles);
 const offA=a.registerRoleContribution({events:bus},{owner,roleDirectories:[roles]}),offB=b.registerRoleContribution({events:bus},{owner,roleDirectories:[roles]});
 assert.equal(b.collectRoleContributions(bus,[owner]).length,1);offA();offB();assert.equal(a.collectRoleContributions(bus,[owner]).length,0);bus.clear();
 assert.equal(Object.keys(a.discoverRoles({cwd:dir,agentDir:join(dir,'agent'),projectTrusted:false})).length,5);
 const sourceBus=pi.createEventBus();
 const loader=new pi.DefaultResourceLoader({cwd:dir,agentDir:join(dir,'agent'),settingsManager:pi.SettingsManager.create(dir,join(dir,'agent'),{projectTrusted:false}),eventBus:sourceBus,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,additionalExtensionPaths:[join(pathA,'src/extension.ts')]});
 try {await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);const contributions=b.collectRoleContributions(sourceBus,loader.getExtensions());assert.equal(contributions.length,1);assert.equal(contributions[0].scope,'builtin');assert.equal(Object.keys(b.discoverRoles({cwd:dir,agentDir:join(dir,'agent'),additionalRoleSources:contributions})).length,5);}
 finally {loader.getExtensions().runtime.invalidate();sourceBus.clear();}
 const consumerOptions={cwd:dir,agentDir:join(dir,'agent'),projectTrusted:false,useSharedSettings:false,
  definition:{prompt:'ROLE',model:'p/role:low',tools:['!*','read','write'],skills:['!*','kept'],extensions:['!*','builtin:kept'],contextFiles:['global'],extensionSettings:{role:{enabled:true},replace:'role'},overrideSystemPrompt:true},
  selectorSources:{global:{},project:{}},resources:{tools:['read','write'],skills:['kept','other'],extensions:['builtin:kept','builtin:other']},rootTools:['read'],inheritedTools:['read','write'],
  model:'p/override:high',knownModels:new Set(['p/override']),prompt:'CALL',contextFiles:['cwd'],extensionSettings:{replace:'call',consumer:null}};
 const resolved=a.resolveRole('custom',consumerOptions);
 // The consumer applies returned options without any package-owned runtime.
 const consumer={model:resolved.model,prompt:resolved.systemPrompt,tools:resolved.tools,skills:resolved.selectedSkills,extensions:resolved.selectedExtensions,settings:resolved.extensionSettings,context:resolved.contextFiles};
 assert.deepEqual(consumer,{model:{provider:'p',model:'override',thinking:'high'},prompt:{mode:'override',text:'CALL'},tools:['read'],skills:['kept'],extensions:['builtin:kept'],settings:{role:{enabled:true},replace:'call',consumer:null},context:['cwd']});
 assert.deepEqual(resolved.selectorSources.role.tools,['!*','read','write']);assert.equal(resolved.selectorLayers.tools.length,4);
 assert.throws(()=>a.resolveRole('custom',{...consumerOptions,effectiveTools:['write']}),e=>e.code==='UNKNOWN_TOOL');
 const removed=['prepareRoleApplication','createRoleRuntime','createRoleSnapshot','restoreRoleSnapshot','roleExtensionSettings','getRoleExtensionSettings','ROLE_SETTINGS_CHANNEL','ROLE_SNAPSHOT_TYPE','PrepareRoleApplicationOptions','PreparedRoleApplication','CreateRoleRuntimeOptions','RoleSnapshot','RoleSessionStartEvent'];
 for(const name of removed) assert.ok(!(name in a),name);
 for(const file of packed.files.filter(f=>f.path.endsWith('.d.ts'))) {
  const declaration=readFileSync(join(pathA,file.path),'utf8');
  for(const name of removed) assert.ok(!new RegExp(`\\b${name}\\b`).test(declaration),`${file.path}: ${name}`);
 }
 await assert.rejects(import(pathToFileURL(join(pathA,'dist/pi.js'))),{code:'ERR_MODULE_NOT_FOUND'});
 writeFileSync(join(dir,'a/source-contract.ts'),`import { resolveRole, discoverRoles, composeRoleConfiguration, RoleError, canonicalPath, registerRoleContribution, type AgentDefinition, type RoleResolutionOptions, type ResolvedRole, type ModelSpec, type ContextFileScope, type ExtensionSettings, type AgentResourceSelectorSources } from '@piewf/pi-ext-roles';
import { runPiRole } from '@piewf/pi-ext-roles/launcher';
const options: RoleResolutionOptions = {cwd:'.',definition:{prompt:'',contextFiles:['cwd'],extensionSettings:{fixture:true}} satisfies AgentDefinition,resources:{tools:['read']},rootTools:['read']};
const role: ResolvedRole=resolveRole('custom', options);
const model: ModelSpec | undefined=role.model;
const prompt: {mode:'override'|'append';text:string}=role.systemPrompt;
const tools: readonly string[] | undefined=role.tools;
const context: readonly ContextFileScope[] | undefined=role.contextFiles;
const settings: Readonly<ExtensionSettings> | undefined=role.extensionSettings;
const sources: AgentResourceSelectorSources=role.selectorSources;
const layers: readonly (readonly string[] | undefined)[]=role.selectorLayers.tools;
void composeRoleConfiguration(options); void discoverRoles(options); void RoleError; void canonicalPath; void registerRoleContribution; void runPiRole;
// @ts-expect-error Removed runtime subpath is not exported.
import {} from '@piewf/pi-ext-roles/pi';
// @ts-expect-error Roles produce options, not owned SDK runtimes or snapshots.
import { prepareRoleApplication, createRoleRuntime, createRoleSnapshot, restoreRoleSnapshot, roleExtensionSettings, getRoleExtensionSettings, ROLE_SETTINGS_CHANNEL, ROLE_SNAPSHOT_TYPE, type PrepareRoleApplicationOptions, type PreparedRoleApplication, type CreateRoleRuntimeOptions, type RoleSnapshot, type RoleSessionStartEvent } from '@piewf/pi-ext-roles';
`);
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',join(dir,'a/source-contract.ts')],{cwd:join(dir,'a'),stdio:'pipe'});
 console.log('PASS: packed pure options, removed runtime exports/artifacts/types, resources/source entrypoint, standalone install, two API copies and consumer typecheck');
} finally {rmSync(dir,{recursive:true,force:true});}
