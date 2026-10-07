import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),cli=join(root,'dist/cli.js');
function put(path,text) {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'pi-role-cli-')),cwd=join(dir,'project'),agentDir=join(dir,'agent'),log=join(dir,'events.jsonl');mkdirSync(cwd,{recursive:true});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const extension=join(agentDir,'extensions/fixture.js');
 put(extension,`import {appendFileSync} from 'node:fs';
export default function(api) {const log=value=>appendFileSync(${JSON.stringify(log)},JSON.stringify(value)+'\\n');log({type:'factory'});
api.registerProvider('fixture',{api:'openai-completions',baseUrl:'http://127.0.0.1:1',apiKey:'fixture',models:[{id:'model',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:1024}]});
api.on('session_start',(event,ctx)=>log({type:'start',settings:event.settings,prompt:ctx.getSystemPrompt(),tools:api.getActiveTools()}));
api.on('session_shutdown',()=>log({type:'shutdown'}));}`);
 put(join(agentDir,'pi-ext-roles/roles/fixture.md'),'---\nmodel: fixture/model:medium\ncontextFiles: []\ntools: ["!*", "read"]\nextensionSettings: {"fixture":{"enabled":true}}\n---\nCLI_ROLE');
 put(join(agentDir,'SYSTEM.md'),'BASE_CLI');
 put(join(agentDir,'settings.json'),JSON.stringify({extensions:['-extensions/disabled.js'],cacheWarming:'off',defaultProjectTrust:'never'}));
 put(join(agentDir,'extensions/disabled.js'),`import {appendFileSync} from 'node:fs';export default ()=>appendFileSync(${JSON.stringify(log)},JSON.stringify({type:'disabled'})+'\\n');`);
 put(join(cwd,'.pi/extensions/project.js'),`import {appendFileSync} from 'node:fs';export default ()=>appendFileSync(${JSON.stringify(log)},JSON.stringify({type:'project'})+'\\n');`);
 const env={...process.env,PI_OFFLINE:'1',PI_CODING_AGENT_DIR:agentDir,HOME:dir,XDG_CACHE_HOME:join(dir,'cache')};
 const events=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];
 return {cwd,agentDir,dir,log,env,events};
}
test('real native launcher empty headless mode, ignored settings, tool ceiling, invalid model and stock no-role delegation',t=>{
 const f=fixture(t);
 const run=(args)=>spawnSync(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});
 const printed=run(['fixture','-p','--no-session']);assert.equal(printed.status,0,printed.stderr);
 assert.deepEqual(f.events().map(e=>e.type),['factory','start','shutdown']);
 const started=f.events()[1];assert.deepEqual(started.tools,['read']);assert.equal(started.settings,undefined);assert.ok(started.prompt.includes('CLI_ROLE'));assert.ok(started.prompt.includes('BASE_CLI'));
 const invalid=run(['fixture','-p','--no-session','--model','missing-provider/missing:high']);assert.equal(invalid.status,1);assert.match(invalid.stderr,/Unknown model|Unavailable model|not found/i);
 assert.equal(f.events().filter(e=>e.type==='start').length,1);
 const disabled=run(['fixture','-p','--no-session','-e',join(f.agentDir,'extensions/disabled.js')]);assert.equal(disabled.status,1);assert.match(disabled.stderr,/disabled or unauthorized/);
 put(join(f.agentDir,'extensions/package.json'),JSON.stringify({pi:{extensions:['./disabled.js','./fixture.js']}}));
 const directory=run(['fixture','-p','--no-session','-e',join(f.agentDir,'extensions')]);assert.equal(directory.status,1);assert.match(directory.stderr,/disabled or unauthorized/);
 const untrusted=run(['fixture','-p','--no-session','-e',join(f.cwd,'.pi/extensions/project.js')]);assert.equal(untrusted.status,1);assert.match(untrusted.stderr,/disabled or unauthorized/);
 assert.ok(!f.events().some(e=>['disabled','project'].includes(e.type)));
 const listed=run(['--list']);assert.equal(listed.status,0,listed.stderr);assert.match(listed.stdout,/fixture/);assert.match(listed.stdout,/scout/);
 const normal=run(['--version']);assert.equal(normal.status,0,normal.stderr);assert.equal(normal.stdout,spawnSync('pi',['--version'],{cwd:f.cwd,env:f.env,encoding:'utf8'}).stdout);
});
test('real native launcher RPC get_state and native abrupt SIGINT/SIGTERM/SIGHUP exits',async t=>{
 for(const [signal,expectedCode] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]]) {
 const f=fixture(t),child=spawn(process.execPath,[cli,'fixture','--mode','rpc','--no-session'],{cwd:f.cwd,env:f.env,stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 let output='',stderr='';child.stderr.on('data',d=>stderr+=d);
 const response=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;for(const line of output.split('\n')){try{const response=JSON.parse(line);if(response.id==='state')resolve(response);}catch{}}});child.on('error',reject);child.on('exit',(code)=>{if(!output.includes('"id":"state"'))reject(new Error(`RPC exited ${code}: ${stderr}`));});});
 const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
 child.stdin.write(JSON.stringify({id:'state',type:'get_state'})+'\n');
 const state=await response;assert.equal(state.success,true);assert.equal(state.data.model.provider,'fixture');
 child.kill(signal);assert.deepEqual(await exited,{code:expectedCode,signal:null});
 assert.deepEqual(f.events().slice(0,2).map(e=>e.type),['factory','start']);assert.ok(f.events().filter(e=>e.type==='shutdown').length<=1);
 }
});
test('CLI system and append prompts resolve files and inline values including empty override',t=>{
 const f=fixture(t),system=join(f.dir,'system.md'),append=join(f.dir,'append.md');put(system,'EXPLICIT_SYSTEM');put(append,'EXPLICIT_APPEND');put(join(f.agentDir,'APPEND_SYSTEM.md'),'DISCOVERED_APPEND');
 for(const input of [system,'INLINE_SYSTEM','']) {
  const run=spawnSync(process.execPath,[cli,'fixture','-p','--no-session','--system-prompt',input,'--append-system-prompt',append],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);const prompt=f.events().filter(e=>e.type==='start').at(-1).prompt;
  assert.ok(prompt.includes('EXPLICIT_APPEND'));assert.ok(!prompt.includes('DISCOVERED_APPEND'));assert.ok(!prompt.includes('BASE_CLI'));assert.ok(!prompt.includes(system));if(input)assert.ok(prompt.includes(input===system?'EXPLICIT_SYSTEM':input));
 }
});
test('pure list/help discovery, selected-out factories, aliases, scopes and literal role flags after --',t=>{
 const f=fixture(t),run=args=>spawnSync(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});
 assert.equal(run(['--list']).status,0);assert.equal(run(['fixture','--help']).status,0);assert.equal(run(['--help']).status,0);assert.deepEqual(f.events(),[]);
 const excluded=join(f.agentDir,'extensions/excluded.js');put(excluded,`throw new Error('SELECTED_OUT_FACTORY_EXECUTED');`);
 put(join(f.agentDir,'skills/alpha/SKILL.md'),'---\nname: alpha\ndescription: ALPHA_SELECTED\n---\nAlpha');
 put(join(f.agentDir,'skills/beta/SKILL.md'),'---\nname: beta\ndescription: BETA_EXCLUDED\n---\nBeta');
 put(join(f.agentDir,'pi-ext-roles/roles/fixture.md'),`---\nmodel: chosen\ncontextFiles: []\ntools: ['!*', 'r*']\nskills: ['!*', 'alpha*']\nextensions: ['!*', '${join(f.agentDir,'extensions/*.js')}', '!${excluded}']\n---\nCLI_ROLE`);
 put(join(f.agentDir,'pi-ext-roles/settings.json'),JSON.stringify({modelAliases:{chosen:'fixture/model:medium'}}));
 assert.equal(run(['fixture','-p','--no-session']).status,0);assert.deepEqual(f.events().map(e=>e.type),['factory','start','shutdown']);assert.deepEqual(f.events()[1].tools,['read']);assert.match(f.events()[1].prompt,/ALPHA_SELECTED/);assert.ok(!f.events()[1].prompt.includes('BETA_EXCLUDED'));
 put(join(f.agentDir,'pi-ext-roles/roles/partial.md'),'---\ncontextFiles: [cwd]\n---\nPARTIAL');
 const partial=run(['partial','-p']);assert.equal(partial.status,1);assert.match(partial.stderr,/Partial contextFiles scope/);
 rmSync(excluded);assert.equal(run(['partial','-p','--no-context-files','--no-session','--model','fixture/model:medium']).status,0);
 const literal=run(['--version','--','--role','--list','--help']);assert.equal(literal.status,0);assert.ok(!literal.stdout.includes('Usage: pi-role'));assert.ok(!literal.stderr.includes('--role requires'));
});
test('native explicit tools override role, exclusions and absolute no-tools/no-builtin ceilings resist reenable',t=>{
 const f=fixture(t),extension=join(f.agentDir,'extensions/fixture.js');
 put(extension,readFileSync(extension,'utf8').replace("api.on('session_start'",`api.registerTool({name:'extra',label:'Extra',description:'Extra',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'extra'}]})});
api.on('session_start',()=>{api.setActiveTools(['read','bash','extra']);});
api.on('session_start'`));
 for(const [args,expected] of [[['--tools','bash'],['bash']],[['--tools','read,bash','--exclude-tools','read'],['bash']],[['--no-tools','--tools','read,extra'],[]],[['--no-builtin-tools','--tools','read,extra'],['extra']]]) {
  const run=spawnSync(process.execPath,[cli,'fixture','-p','--no-session',...args],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stderr);assert.deepEqual(f.events().filter(e=>e.type==='start').at(-1).tools,expected);
 }
});
test('native wildcard bridge and private flag survive reload; native hard ceilings survive late reenable', {timeout:30000},async t=>{
 for(const extra of [[],['--tools','read','--exclude-tools','read'],['--no-tools','--tools','read'],['--no-builtin-tools','--tools','read,read_extra']]) {
  const f=fixture(t),extension=join(f.agentDir,'extensions/fixture.js');
  put(join(f.agentDir,'pi-ext-roles/roles/fixture.md'),'---\nmodel: fixture/model:medium\ntools: ["!*", "r*"]\ncontextFiles: []\n---\nROLE');
  put(extension,readFileSync(extension,'utf8').replace("api.on('session_start'",`api.registerTool({name:'read_extra',label:'Extra',description:'Extra',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'extra'}]})});
api.registerCommand('reloadprobe',{description:'Fixture reload',handler:async(args,ctx)=>{await ctx.reload();}});
api.on('session_start'`).replace("api.on('session_shutdown'", `api.on('session_start',(event,ctx)=>{if(event.reason==='reload'){${extra.length ? "api.setActiveTools(['read','bash','read_extra']);" : ""}log({type:'reloaded',active:api.getActiveTools(),all:api.getAllTools().map(t=>t.name)});ctx.ui.notify('reloaded');}});
api.on('session_shutdown'`));
  const child=spawn(process.execPath,[cli,'fixture','--mode','rpc','--no-session',...extra],{cwd:f.cwd,env:f.env,stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const pending=new Map();let buffer='',stderr='';child.stderr.on('data',d=>stderr+=d);
  child.stdout.on('data',d=>{buffer+=d;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const event=JSON.parse(line);pending.get(event.message==='reloaded'?'reloaded':event.id)?.(event);}catch{}}});
  const ask=command=>new Promise(resolve=>{pending.set(command.id,resolve);child.stdin.write(JSON.stringify(command)+'\n');});
  assert.equal((await ask({id:'initial',type:'get_state'})).success,true);
  const reloaded=new Promise(resolve=>pending.set('reloaded',resolve));
  assert.equal((await ask({id:'reload',type:'prompt',message:'/reloadprobe'})).success,true,stderr);await reloaded;
  // The command reenabled tools after reload; the explicit native registry must constrain it.
  const expected=extra.includes('--no-tools')||extra.includes('--exclude-tools')?[]:extra.includes('--no-builtin-tools')?['read_extra']:['read','read_extra'];
  assert.deepEqual(f.events().find(e=>e.type==='reloaded').active,expected);
  const starts=f.events().filter(e=>e.type==='start');assert.equal(starts.length,2);
  const selected=extra.length===0?['read','read_extra']:extra.includes('--no-builtin-tools')?['read_extra']:[];
  assert.deepEqual(starts[1].tools,selected);
  const exit=new Promise(resolve=>child.on('exit',resolve));child.kill('SIGTERM');await exit;
 }
});
test('malformed private native bridge payload visibly exits closed',t=>{
 const f=fixture(t),bridge=join(root,'dist/cli-tool-bridge.js');
 const result=spawnSync('pi',['-p','--no-session','-e',bridge,'--pi-role-tool-layers','[null,null,null,[1]]'],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});
 assert.equal(result.status,1);assert.match(result.stderr,/invalid tool selector payload/);
 assert.ok(!f.events().some(e=>e.type==='start'));
});
test('launcher scans options with their values: prompt literals equal to flags are preserved and never taken as role/list/help',t=>{
 const f=fixture(t),run=args=>spawnSync(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});
 const prompts=()=>f.events().filter(e=>e.type==='start').map(e=>e.prompt);
 for(const literal of ['--help','-h','--list','--role','-e','--model']) {
  const before=prompts().length,result=run(['fixture','--no-approve','--system-prompt',literal,'-p','--no-session']);
  assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes('Usage: pi-role'));assert.equal(prompts().length,before+1);assert.ok(prompts().at(-1).includes(literal));
 }
 // Role-selecting --role and role-less launches stay native when their text is only an option value.
 const stock=run(['--no-approve','--system-prompt','--role','--version']);assert.equal(stock.status,0,stock.stderr);assert.ok(!stock.stderr.includes('pi-role:'));assert.ok(!stock.stdout.includes('Usage: pi-role'));
 const named=run(['--role','fixture','--system-prompt','--list','-p','--no-session']);assert.equal(named.status,0,named.stderr);assert.ok(!named.stdout.includes('Usage: pi-role'));assert.ok(prompts().at(-1).includes('--list'));
 // stripOptions must not eat a prompt value that equals a stripped option name.
 put(join(f.agentDir,'pi-ext-roles/roles/fixture.md'),`---\nmodel: fixture/model:medium\ncontextFiles: []\ntools: ["!*", "read"]\nextensions: ["!*", "${join(f.agentDir,'extensions/fixture.js')}"]\n---\nCLI_ROLE`);
 const stripped=run(['fixture','-p','--no-session','--system-prompt','-e']);assert.equal(stripped.status,0,stripped.stderr);assert.ok(prompts().at(-1).includes('-e'));
 // Unknown role named after a real option value is still reported, and list/help stay factory-free.
 const missing=run(['definitely-not-a-role','-p']);assert.equal(missing.status,1);assert.match(missing.stderr,/Unknown agent role/);
 const before=f.events().length;assert.equal(run(['--no-approve','--list']).status,0);assert.equal(run(['fixture','-h']).status,0);assert.equal(f.events().length,before);
 // Option values do not hide a real --list/--help that follows them.
 const listed=run(['--system-prompt','x','--list']);assert.equal(listed.status,0);assert.match(listed.stdout,/Usage: pi-role/);
});
test('launcher keeps --thinking values and raw inline flags native, never as help or launcher --role/--model/--extension',t=>{
 const f=fixture(t),run=args=>spawnSync(process.execPath,[cli,...args],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:20000});
 const starts=()=>f.events().filter(e=>e.type==='start').length;
 // Native consumes the next token even when invalid: it is a warning, not the help flag.
 const thinking=run(['fixture','--thinking','--help','-p','--no-session']);assert.equal(thinking.status,0,thinking.stderr);
 assert.ok(!thinking.stdout.includes('Usage: pi-role'));assert.match(thinking.stderr,/Invalid thinking level "--help"/);assert.equal(starts(),1);
 // Inline forms are unsupported syntax: --role=x is an unknown native flag and must not swallow the prompt as a role.
 const custom=join(f.agentDir,'extensions/custom.js'),received=join(f.dir,'received.json');
 put(custom,`import {writeFileSync} from 'node:fs';export default function(api){api.registerFlag('custom',{type:'string'});api.registerFlag('role',{type:'string'});api.on('session_start',()=>writeFileSync(${JSON.stringify(received)},JSON.stringify({custom:api.getFlag('custom'),role:api.getFlag('role')})));}`);
 const before=starts();
 const inline=run(['fixture','--no-session','-p','-e',custom,'--role=ignored','--custom=a']);
 assert.equal(inline.status,0,inline.stderr);assert.equal(starts(),before+1);
 const flags=JSON.parse(readFileSync(received,'utf8'));assert.equal(flags.role,'ignored');assert.equal(flags.custom,'a');
 // Inline private selector flag stays rejected, same as the separate form.
 const layers=run(['fixture','-p','--no-session','--pi-role-tool-layers=[null,null,null,["*"]]']);assert.equal(layers.status,1);assert.match(layers.stderr,/Private tool selector flag cannot be supplied/);
 // Unregistered inline model/extension forms are forwarded raw and rejected by native Pi, not interpreted by the launcher.
 const raw=run(['fixture','--no-session','-p','--model=fixture/model','--extension='+custom]);assert.equal(raw.status,1);assert.match(raw.stderr,/Unknown options: --model, --extension|Unknown options: --extension, --model/);assert.equal(starts(),before+1);
 // Inline flag values survive resource composition (extension selector strips only launcher --extension).
 put(join(f.agentDir,'pi-ext-roles/roles/fixture.md'),`---\nmodel: fixture/model:medium\ncontextFiles: []\nextensions: ["!*", "${join(f.agentDir,'extensions/fixture.js')}", "${custom}"]\n---\nCLI_ROLE`);
 const composed=run(['fixture','--no-session','-p','--custom=kept']);assert.equal(composed.status,0,composed.stderr);
 assert.equal(JSON.parse(readFileSync(received,'utf8')).custom,'kept');
 // Without a leading role, the raw inline option is not a role selector or prompt-as-role.
 const noRole=run(['--role=fixture','hello','--version']);assert.equal(noRole.status,0,noRole.stderr);assert.ok(!noRole.stderr.includes('pi-role:'));
});
