import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEventBus, createExtensionRuntime, ExtensionRunner, SessionManager } from '@earendil-works/pi-coding-agent';
import { loadExtensions } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';
import { createRequire } from 'node:module';
const requireSdk = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const { Value } = await import(pathToFileURL(requireSdk.resolve('typebox/value')));
const root=fileURLToPath(new URL('..',import.meta.url));
function put(path,text) {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
function fixture(t, registry) {
 const dir=mkdtempSync(join(tmpdir(),'roles-loading-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(join(root,'dist'),join(dir,'dist'),{recursive:true});cpSync(join(root,'starter'),join(dir,'starter'),{recursive:true});
 cpSync(join(root,'package.json'),join(dir,'package.json'));
 mkdirSync(join(dir,'node_modules/@earendil-works'),{recursive:true});
 for(const name of ['@earendil-works/pi-coding-agent','minimatch'])symlinkSync(join(root,'node_modules',name),join(dir,'node_modules',name));
 if(registry) {
  put(join(dir,'node_modules/pi-extensible-workflows/package.json'),JSON.stringify({name:'pi-extensible-workflows',type:'module',exports:{'.':'./index.js','./registry':'./registry.js'}}));
  put(join(dir,'node_modules/pi-extensible-workflows/index.js'),'throw new Error("ROOT_RUNTIME_MUST_NOT_LOAD");');
  put(join(dir,'node_modules/pi-extensible-workflows/registry.js'),registry);
 }
 const bus=createEventBus(),runtime=createExtensionRuntime();t.after(()=>{runtime.invalidate();bus.clear();});
 return {dir,bus,runtime,path:join(dir,'dist/extension.js')};
}
test('Pi loader tolerates absent workflows without importing the adapter or contributing redundant builtins',async t=>{
 const f=fixture(t),loaded=await loadExtensions([f.path],f.dir,f.bus,f.runtime);
 assert.deepEqual(loaded.errors,[]);assert.equal(loaded.extensions.length,1);
 assert.deepEqual([...loaded.extensions[0].handlers.keys()],['before_agent_start']);
});
test('Pi loader registers the generic hook before freeze in both contributor orders and honors lifecycle',async t=>{
 for(const rolesFirst of [false,true]) {
  const f=fixture(t,'export let registration;export function registerWorkflowExtension(value){registration=value;}export function loadingRegistry(){return {frozen:false};}');
  const contributor=join(f.dir,'contributor.js');put(join(f.dir,'roles/custom.md'),'CUSTOM');
  put(contributor,`import {registerRoleContribution} from './dist/index.js';export default pi=>registerRoleContribution(pi,{owner:import.meta.url,roleDirectories:['./roles']});`);
  const loaded=await loadExtensions(rolesFirst?[f.path,contributor]:[contributor,f.path],f.dir,f.bus,f.runtime);assert.deepEqual(loaded.errors,[]);
  const {registration}=await import(pathToFileURL(join(f.dir,'node_modules/pi-extensible-workflows/registry.js')));
  const hook=registration.agentPreparationHooks.roles;
  assert.equal(Value.Check(hook.optionsSchema,{role:'custom',extra:42}),true);
  assert.equal(Value.Check(hook.optionsSchema,{role:42}),false);assert.equal(Value.Check(hook.optionsSchema,{}),true);
  const prepare=()=>{const config={tools:[],skills:[],extensions:[],systemPromptAppend:'',settings:{}};hook.prepare(config,{options:{role:'custom'},cwd:f.dir,agentDir:join(f.dir,'agent'),projectTrusted:false,defaults:{model:{provider:'p',model:'m'},modelAliases:{},selectorSources:{global:{},project:{}},settings:{}},capabilities:{tools:[],skills:[],extensions:[]},knownModels:new Set(['p/m']),availableModels:new Set(['p/m']),signal:new AbortController().signal,mode:'inspection'});return config;};
  assert.throws(prepare,/Unknown agent role/);
  const runner=new ExtensionRunner(loaded.extensions,f.runtime,f.dir,SessionManager.inMemory(f.dir),{});
  try {await runner.emit({type:'session_start',reason:'startup'});assert.equal(prepare().systemPromptAppend,'CUSTOM');await runner.emit({type:'session_shutdown',reason:'quit'});assert.throws(prepare,/Unknown agent role/);}
  finally {runner.invalidate();}
 }
});
test('frozen child registry does not register a second time',async t=>{
 const f=fixture(t,'export function registerWorkflowExtension(){throw new Error("DUPLICATE_REGISTRATION");}export function loadingRegistry(){return {frozen:true};}');
 const loaded=await loadExtensions([f.path],f.dir,f.bus,f.runtime);assert.deepEqual(loaded.errors,[]);
});
test('present workflows with broken registry, API, or registration fail visibly rather than disabling roles',async t=>{
 for(const registry of ['throw new Error("BROKEN_REGISTRY");','export function loadingRegistry(){return {frozen:false};}', 'export function loadingRegistry(){return {frozen:false};}export function registerWorkflowExtension(){throw new Error("BROKEN_REGISTRATION");}']) {
  const f=fixture(t,registry),loaded=await loadExtensions([f.path],f.dir,f.bus,f.runtime);assert.equal(loaded.errors.length,1);assert.match(loaded.errors[0].error,/BROKEN_|registerWorkflowExtension/);
 }
 const f=fixture(t,'export function loadingRegistry(){return {frozen:false};}');rmSync(join(f.dir,'node_modules/pi-extensible-workflows/registry.js'));
 const loaded=await loadExtensions([f.path],f.dir,f.bus,f.runtime);assert.equal(loaded.errors.length,1);assert.match(loaded.errors[0].error,/registry/);
 const missingRoot=fixture(t,'export function loadingRegistry(){return {frozen:false};}');rmSync(join(missingRoot.dir,'node_modules/pi-extensible-workflows/index.js'));
 const broken=await loadExtensions([missingRoot.path],missingRoot.dir,missingRoot.bus,missingRoot.runtime);assert.equal(broken.errors.length,1);
});
