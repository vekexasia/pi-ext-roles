import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEventBus, ExtensionRunner, SessionManager, createExtensionRuntime } from '@earendil-works/pi-coding-agent';
import { loadExtensions } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';
import { collectRoleContributions, registerRoleContribution, ROLE_COLLECTION_CHANNEL } from '../dist/index.js';

test('active collection uses actual runner lifecycle, tool-less owners, both orders, invalidation and isolated buses', async t => {
 const dir=mkdtempSync(join(tmpdir(),'roles-active-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../dist',import.meta.url),join(dir,'copy'),{recursive:true});
 writeFileSync(join(dir,'package.json'),'{"type":"module"}');
 symlinkSync(new URL('../node_modules',import.meta.url),join(dir,'node_modules'));
 const owner=join(dir,'contributor.mjs'), consumer=join(dir,'consumer.mjs');
 mkdirSync(dirname(owner),{recursive:true});
 writeFileSync(owner,`import {registerRoleContribution} from ${JSON.stringify(pathToFileURL(join(dir,'copy/index.js')).href)}; export default pi=>registerRoleContribution(pi,{owner:import.meta.url,roleDirectories:['./roles']});`);
 writeFileSync(consumer,'export default pi=>{}');
 for(const paths of [[owner,consumer],[consumer,owner]]) {
  const bus=createEventBus(), runtime=createExtensionRuntime();
  const loaded=await loadExtensions(paths,dir,bus,runtime);assert.deepEqual(loaded.errors,[]);
  assert.equal(collectRoleContributions(bus,loaded).length,1);
  assert.equal(collectRoleContributions(bus,{activeOnly:true}).length,0);
  const runner=new ExtensionRunner(loaded.extensions,runtime,dir,SessionManager.inMemory(dir),{});
  await runner.emit({type:'session_start',reason:'startup'});
  assert.equal(collectRoleContributions(bus,{activeOnly:true}).length,1);
  assert.equal(collectRoleContributions(createEventBus(),{activeOnly:true}).length,0);
  await runner.emit({type:'session_shutdown',reason:'reload'});
  assert.equal(collectRoleContributions(bus,{activeOnly:true}).length,0);
  runner.invalidate();assert.equal(collectRoleContributions(bus,loaded).length,0);
 }
 const bus=createEventBus(),runtime=createExtensionRuntime(),loaded=await loadExtensions([owner,consumer],dir,bus,runtime);
 const runner=new ExtensionRunner(loaded.extensions.filter(e=>e.resolvedPath!==owner),runtime,dir,SessionManager.inMemory(dir),{});
 await runner.emit({type:'session_start',reason:'startup'});
 assert.equal(collectRoleContributions(bus,{activeOnly:true}).length,0);
 runner.invalidate();bus.clear();
});

test('explicit disposal removes contribution and both lifecycle subscriptions',()=>{
 const bus=createEventBus(),handlers=new Map(),owner=join(tmpdir(),'disposed-role-contributor.mjs');
 const unsubscribe=registerRoleContribution({events:bus,on(event,handler){handlers.set(event,handler);return()=>handlers.delete(event);}}, {owner,roleDirectories:[join(tmpdir(),'disposed-roles')]});
 assert.equal(handlers.size,2);
 handlers.get('session_start')();
 assert.equal(collectRoleContributions(bus,{activeOnly:true}).length,1);
 unsubscribe();unsubscribe();
 assert.equal(handlers.size,0);
 assert.equal(collectRoleContributions(bus,[owner]).length,0);
 bus.clear();
});

test('older event-only responders are accepted only with explicit loaded membership',()=>{
 const bus=createEventBus(),owner=join(tmpdir(),'older-api.mjs');
 bus.on('pi-ext-roles:collect:v1',request=>request.reply({owner,directories:[{path:join(tmpdir(),'older-roles')}]}));
 assert.equal(collectRoleContributions(bus,[owner]).length,1);
 assert.equal(collectRoleContributions(bus,{activeOnly:true}).length,0);
 bus.clear();
});

test('cross-copy synchronous contribution collection, membership, deterministic dedup, unsubscribe and separate buses',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'pi-role-copies-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../dist',import.meta.url),join(dir,'copy'),{recursive:true});writeFileSync(join(dir,'package.json'),'{"type":"module"}');symlinkSync(new URL('../node_modules',import.meta.url),join(dir,'node_modules'));
 const other=await import(pathToFileURL(join(dir,'copy/contributions.js')));
 const bus=createEventBus(),separate=createEventBus();t.after(()=>{bus.clear();separate.clear();});
 const owner=join(dir,'extension.js'),path=join(dir,'roles');
 const a=registerRoleContribution({events:bus},{owner,roleDirectories:[{path,scope:'global',priority:-100}]});
 const b=other.registerRoleContribution({events:bus},{owner,roleDirectories:[{path,scope:'global',priority:-100}]});
 assert.equal(other.collectRoleContributions(bus,[owner]).length,1);
 assert.equal(collectRoleContributions(bus,[]).length,0);assert.equal(collectRoleContributions(separate,[owner]).length,0);
 a();assert.equal(collectRoleContributions(bus,[owner]).length,1);b();assert.equal(collectRoleContributions(bus,[owner]).length,0);
 const off=bus.on(ROLE_COLLECTION_CHANNEL,request=>request.reply({owner,directories:[{path,owner:join(dir,'forged.js')}]}));
 assert.throws(()=>collectRoleContributions(bus,[owner]),e=>e.code==='INVALID_METADATA');off();
});
test('file: URL membership matches canonical contributor identity',t=>{
 const dir=mkdtempSync(join(tmpdir(),'roles-url-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const owner=join(dir,'contributor.mjs'),bus=createEventBus();
 registerRoleContribution({events:bus},{owner:pathToFileURL(owner).href,roleDirectories:['./roles']});
 const found=collectRoleContributions(bus,[pathToFileURL(owner).href]);
 assert.equal(found.length,1);assert.equal(found[0].scope,'extension');assert.equal(found[0].path,join(dir,'roles'));
 assert.equal(collectRoleContributions(bus,[pathToFileURL(join(dir,'other.mjs')).href]).length,0);
});
