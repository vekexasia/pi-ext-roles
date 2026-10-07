import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToolLayers } from '../dist/cli-tool-bridge.js';
const root=fileURLToPath(new URL('..',import.meta.url)),cli=join(root,'dist/cli.js');
test('private payload validates every layer, refusing malformed and invalid selectors',()=>{
 for(const payload of [undefined,'{}','[null]','[null,null,null,1]','[null,null,null,["!"]]'])assert.throws(()=>parseToolLayers(payload));
 assert.deepEqual(parseToolLayers('[null,null,["!*","driver*"],null]'),[undefined,undefined,['!*','driver*'],undefined]);
});
test('native requests, stdin/session passthrough, loadout nested execution and absolute callable ceilings', {timeout:90000}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'roles-native-')),cwd=join(dir,'cwd'),agent=join(dir,'agent'),log=join(dir,'events');
 mkdirSync(cwd);mkdirSync(join(agent,'extensions'),{recursive:true});mkdirSync(join(agent,'pi-ext-roles/roles'),{recursive:true});
 let calls=[],names=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);calls.push(request);
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'native',object:'chat.completion.chunk',created:1,model:'model',choices:[{index:0,delta,finish_reason}]})}\n\n`;
  if(calls.length===1){res.write(chunk({role:'assistant',tool_calls:names.map((name,index)=>({index,id:`tool-${index}`,type:'function',function:{name,arguments:'{}'}}))}));res.write(chunk({},'tool_calls'));}
  else {res.write(chunk({role:'assistant',content:'NATIVE_OK'}));res.write(chunk({},'stop'));}
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(agent,'settings.json'),JSON.stringify({cacheWarming:'off',defaultProjectTrust:'never',extensions:['-builtin:mcp','-builtin:codemode','-builtin:tool-search','-builtin:llama.cpp']}));
 writeFileSync(join(agent,'pi-ext-roles/roles/fixture.md'),'---\nmodel: fixture/model:medium\ntools: ["!*", "driver*"]\ncontextFiles: []\nextensionSettings: {fixture: true}\n---\nNATIVE_ROLE');
 writeFileSync(join(agent,'extensions/fixture.js'),`import {appendFileSync} from 'node:fs';
export default function(pi){
const log=value=>appendFileSync(${JSON.stringify(log)},JSON.stringify(value)+'\\n');log({type:'factory'});
pi.registerProvider('fixture',{api:'openai-completions',baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'fixture',models:[{id:'model',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:1024}]});
for(const exposure of ['direct','deferred','codemode','hidden','model-only'])pi.registerTool({name:exposure,label:exposure,description:exposure,exposure,parameters:{type:'object',properties:{}},execute:async()=>{log({type:'executed',name:exposure});return {content:[{type:'text',text:exposure}],details:{}};}});
pi.registerTool({name:'driver',label:'Driver',description:'Driver',parameters:{type:'object',properties:{}},execute:async(id,args,signal,update,ctx)=>{for(const name of ['direct','deferred','codemode','hidden','model-only']){try{const result=await ctx.executeTool(name,{});log({type:'nested',name,result});}catch(error){log({type:'nested',name,error:String(error)});}}return {content:[{type:'text',text:'DRIVER_OK'}],details:{}};}});
pi.on('session_start',()=>log({type:'start',all:pi.getAllTools().map(t=>t.name),active:pi.getActiveTools()}));
pi.registerCommand('mute',{description:'Fixture mute',handler:()=>pi.setActiveTools(['direct'])});
pi.registerFlag('try-reenable',{type:'boolean',description:'Fixture'});
pi.on('before_agent_start',()=>{if(pi.getFlag('try-reenable'))pi.setActiveTools(['driver','read','direct','deferred','codemode','hidden','model-only']);log({type:'attempt',active:pi.getActiveTools()});});
pi.on('session_shutdown',()=>log({type:'shutdown'}));
}`);
 const env={...process.env,PI_OFFLINE:'1',PI_CODING_AGENT_DIR:agent,HOME:dir,XDG_CACHE_HOME:join(dir,'cache')};
 async function run(extra,stdin='STDIN_NATIVE') {
  calls=[];writeFileSync(log,'');
  const child=spawn(process.execPath,[cli,'fixture','-p',...(extra.includes('--session')?[]:['--no-session']),...extra],{cwd,env,stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  const exit=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));child.stdin.end(stdin);
  const result=await exit;assert.equal(result.code,0,err);assert.match(out,/NATIVE_OK/);
  return readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
 }
 names=['driver'];
 // The role loadout is not a sandbox. Deferred/codemode tools remain callable.
 let events=await run(['SECOND_NATIVE']);
 assert.ok(calls[0].messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('SECOND_NATIVE')));
 assert.equal(events.filter(e=>e.type==='factory').length,1);
 assert.ok(calls[0].messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('STDIN_NATIVE')));
 assert.ok(calls[0].messages.some(m=>m.role==='system'&&JSON.stringify(m.content).includes('NATIVE_ROLE')));
 assert.deepEqual(events.filter(e=>e.type==='executed').map(e=>e.name),['deferred','codemode']);
 assert.equal(events.filter(e=>e.type==='nested').length,5);
 // Explicit allowlist overrides role selection; exclusions stay registry-wide.
 events=await run(['--tools','driver,deferred,codemode','--exclude-tools','codemode','--try-reenable']);
 assert.deepEqual(events.filter(e=>e.type==='executed').map(e=>e.name),['deferred']);
 assert.ok(!calls[0].tools.some(t=>t.function.name==='codemode'));
 names=['driver','read'];events=await run(['--no-builtin-tools','--try-reenable']);
 assert.ok(!events.find(e=>e.type==='start').all.includes('read'));
 assert.ok(!events.find(e=>e.type==='attempt').active.includes('read'));
 assert.ok(calls[1].messages.some(m=>m.role==='tool'&&m.tool_call_id==='tool-1'&&/not found|unknown tool/i.test(m.content)));
 // Even malicious model calls and handlers cannot revive any exposure under --no-tools.
 names=['driver','direct','deferred','codemode','hidden','model-only','read'];
 events=await run(['--no-tools','--tools',names.join(','),'--try-reenable']);
 assert.deepEqual(events.filter(e=>e.type==='executed'||e.type==='nested'),[]);
 assert.ok(events.filter(e=>e.type==='start'||e.type==='attempt').every(e=>e.active.length===0));
 assert.deepEqual(events.find(e=>e.type==='start').all,[]);
 assert.equal(calls[0].tools?.length??0,0);
 const rejected=calls[1].messages.filter(m=>m.role==='tool');assert.equal(rejected.length,names.length);
 assert.ok(rejected.every(m=>/not found|not available|unknown tool/i.test(m.content)));
 // A later native turn reapplies the role after another extension changes the loadout.
 names=['driver'];calls=[];
 const rpc=spawn(process.execPath,[cli,'fixture','--mode','rpc','--no-session'],{cwd,env,stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(rpc.exitCode===null)rpc.kill('SIGKILL');});
 const waiting=new Map();let buffer='';rpc.stderr.resume();
 rpc.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const event=JSON.parse(line);waiting.get(event.type==='agent_end'?'end':event.id)?.(event);}catch{}}});
 const ask=command=>new Promise(resolve=>{waiting.set(command.id,resolve);rpc.stdin.write(JSON.stringify(command)+'\n');});
 await ask({id:'ready',type:'get_state'});await ask({id:'mute',type:'prompt',message:'/mute'});
 const ended=new Promise(resolve=>waiting.set('end',resolve));
 await ask({id:'turn',type:'prompt',message:'Next native turn'});await ended;
 assert.deepEqual(calls[0].tools.map(t=>t.function.name),['driver']);
 const stopped=new Promise(resolve=>rpc.on('exit',resolve));rpc.kill('SIGTERM');await stopped;
 // Session path and model overrides stay native, with no role SDK snapshot.
 names=['driver'];const session=join(dir,'native-session.jsonl');
 await run(['--session',session,'--model','fixture/model:off','--thinking','off']);
 assert.ok(existsSync(session));assert.ok(!readFileSync(session,'utf8').includes('pi-ext-roles:snapshot'));
});
