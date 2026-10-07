import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import rolesExtension from '../dist/extension.js';
// Use the serializer/schema versions shipped in this SDK's shrinkwrapped install.
const requireSdk = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const ai = new URL('../node_modules/@earendil-works/pi-ai/dist/', import.meta.resolve('@earendil-works/pi-coding-agent'));
const { streamSimple } = await import(new URL('api/openai-codex-responses.js', ai));
const { getModel } = await import(new URL('compat.js', ai));
const { Type } = await import(pathToFileURL(requireSdk.resolve('typebox')));
// Synthetic SSE verifies the real SDK/provider serializer, not remote cache hits or live web services.
for (const [tool,exposure] of [['workflow','direct'], ['subagents_run','direct'], ['subagents_run','deferred']]) test(`role descriptions preserve the dynamic provider prefix: ${tool}/${exposure} (#311)`, async t => {
 const dir=mkdtempSync(join(tmpdir(),'workflow-tool-prefix-')),agentDir=join(dir,'agent');
 mkdirSync(agentDir,{recursive:true});
 t.after(()=>{rmSync(dir,{recursive:true,force:true});});
 const catalog=getModel('openai-codex','gpt-5.6-luna');assert.ok(catalog);
 const model={...catalog,baseUrl:'https://fixture.invalid'};
 assert.equal(model.compat.supportsMidConvoSystemMessages,true);
 assert.equal(model.compat.supportsAdditionalTools,true);
 const token='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture'}})).toString('base64url')+'.x';
 const names=['web_search','web_fetch','web_source_check','web_result'];
 const payloads=[],errors=[],forced=[];
 const settingsManager=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off',defaultTools:[]});
 const loader=new DefaultResourceLoader({cwd:dir,agentDir,settingsManager,noContextFiles:true,noSkills:true,noThemes:true,noPromptTemplates:true,appendSystemPrompt:['EXISTING APPEND'],extensionFactories:[rolesExtension, pi=>{
  pi.registerTool({name:tool,exposure,label:tool,description:'Fixture '+tool,parameters:Type.Object({}),execute:async()=>({content:[],details:{}})});
  for(const name of names)pi.registerTool({name,label:name,description:'Fixture '+name,parameters:Type.Object({}),execute:()=>{throw new Error('web backend must not run');}});
  pi.registerTool({name:'web_enable',label:'Enable Web Access',description:'Activate four web tools.',parameters:Type.Object({}),execute:async()=>{
   pi.setActiveTools([...pi.getActiveTools(),...names]);
   return {content:[{type:'text',text:'Enabled: '+names.join(', ')}],details:{enabled:names}};
  }});
  pi.on('session_start',()=>{pi.setActiveTools(pi.getActiveTools().filter(name=>!names.includes(name)));});
  pi.on('before_agent_start',event=>{forced.push(event.systemPromptOptions.forceSystemPrompt);});
  pi.on('before_provider_request',event=>{payloads.push(globalThis.structuredClone(event.payload));});
 }]});
 await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
 const runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,modelsStorePath:join(agentDir,'models-cache.json'),refreshOnCreate:false});
 runtime.registerProvider('openai-codex',{api:'openai-codex-responses',apiKey:token,models:[model]});
 let calls=0;
 runtime.streamSimple=(_model,context,options)=>streamSimple(model,context,{...options,apiKey:token,transport:'sse',fetch:async()=>{
  const call=++calls;
  assert.ok(call<=3,'unexpected extra model request');
  const item=call===2?{type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:'web_enable',arguments:'{}'}:{type:'message',id:'msg_'+call,role:'assistant',content:[{type:'output_text',text:'ok',annotations:[]}]};
  const events=[{type:'response.created',response:{id:'resp_'+call}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_'+call,status:'completed',output:[item],usage:{input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0}}}}];
  return new globalThis.Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 }});
 const {session}=await createAgentSession({cwd:dir,agentDir,resourceLoader:loader,settingsManager,modelRuntime:runtime,model,thinkingLevel:'off',sessionManager:SessionManager.inMemory(dir)});
 try {
  session.subscribe(event=>{if(event.type==='extension_error')errors.push(event);});
  await session.bindExtensions({});
  assert.ok(names.every(name=>!session.getActiveToolNames().includes(name)));
  await session.prompt('reply ok');
  assert.equal(session.getLastAssistantText(),'ok');
  await session.prompt('call web_enable');
  assert.equal(calls,3);assert.equal(payloads.length,3);
  assert.equal(session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='web_enable'&&!message.isError).length,1);
  assert.ok(names.every(name=>session.getActiveToolNames().includes(name)));
  const [first,second,third]=payloads;
  assert.deepEqual(second.tools,first.tools);
  assert.deepEqual(third.tools,first.tools,'top-level tools must remain anchored to the initial request');
  const additions=third.input.filter(item=>item.type==='additional_tools');
  assert.equal(additions.length,1);
  assert.deepEqual(additions[0].tools.map(tool=>tool.name).sort(),[...names].sort());
  assert.deepEqual(second.input.slice(0,first.input.length),first.input);
  assert.deepEqual(third.input.slice(0,second.input.length),second.input,'no earlier transcript items lost');
  assert.equal(second.instructions,first.instructions);assert.equal(third.instructions,first.instructions);
  assert.match(third.instructions,/EXISTING APPEND[\s\S]*Workflow role descriptions:/);
  for(const name of ['developer','reviewer','scout','oracle','researcher'])assert.ok(third.instructions.includes('`'+name+'`'));
  assert.deepEqual(forced,[undefined,undefined]);assert.deepEqual(errors,[]);
  t.diagnostic(JSON.stringify({tools:payloads.map(payload=>payload.tools.length),additional_tools:payloads.map(payload=>payload.input.filter(item=>item.type==='additional_tools').length)}));
 } finally {
  try {await session.extensionRunner?.emit({type:'session_shutdown',reason:'quit'});} finally {session.dispose();}
 }
});
