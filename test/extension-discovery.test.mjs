import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),cli=join(root,'dist/cli.js'),flag='--discover-extension-roles';
function put(path,text) {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'pi-role-discovery-')),cwd=join(dir,'project'),agentDir=join(dir,'agent'),log=join(dir,'factories.txt');
 mkdirSync(cwd);t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const contribution=(name,path)=>`import {registerRoleContribution} from ${JSON.stringify(join(root,'dist/index.js'))};import {appendFileSync} from 'node:fs';export default function(api){appendFileSync(${JSON.stringify(log)},${JSON.stringify(name+'\n')});registerRoleContribution(api,{owner:import.meta.url,roleDirectories:[${JSON.stringify(path)}]});}`;
 const owner=join(agentDir,'extensions/contributor.js');
 put(owner,contribution('contributor',join(dir,'roles')));
 put(join(dir,'roles/auditor.md'),'---\ncontextFiles: []\noverrideSystemPrompt: true\n---\nCONTRIBUTED_PROMPT');
 put(join(agentDir,'extensions/disabled.js'),contribution('disabled',join(dir,'disabled-roles')));
 put(join(dir,'disabled-roles/disabled-role.md'),'Disabled');
 put(join(cwd,'.pi/extensions/project.js'),contribution('project',join(dir,'project-roles')));
 put(join(dir,'project-roles/project-role.md'),'Project');
 const settings={defaultProjectTrust:'never',cacheWarming:'off',packages:[root],extensions:['-extensions/disabled.js']};
 const save=()=>put(join(agentDir,'settings.json'),JSON.stringify(settings));save();
 const run=(args,env={})=>spawnSync(process.execPath,[cli,...args],{cwd,env:{...process.env,PI_OFFLINE:'1',...env,PI_CODING_AGENT_DIR:agentDir,HOME:dir,XDG_CACHE_HOME:join(dir,'cache')},encoding:'utf8',timeout:20000});
 const events=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n'):[];
 return {dir,cwd,agentDir,owner,settings,save,run,events,contribution};
}
test('opt-in discovers configured contributions, honors trust and keeps the five fallbacks, and leaves defaults pure',t=>{
 const f=fixture(t);
 let result=f.run(['--list']);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/auditor/);assert.match(result.stdout,/scout/);assert.deepEqual(f.events(),[]);
 result=f.run([flag,'--list']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/auditor/);assert.match(result.stdout,/scout/);assert.doesNotMatch(result.stdout,/disabled-role|project-role/);assert.deepEqual(f.events(),['contributor']);
 result=f.run([flag,'--help']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/auditor/);
 result=f.run([flag,'--approve','--list']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/project-role/);
 result=f.run([flag,'--no-approve','--list']);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/project-role/);
 f.settings.packages=[{source:root,extensions:[]}];f.save();
 result=f.run([flag,'--list']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/auditor/);assert.match(result.stdout,/scout/);
 result=f.run(['--list']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/scout/);
 result=f.run([flag,'--no-extensions','--list']);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/auditor/);assert.match(result.stdout,/scout/);
 // The launcher flag is stripped without breaking stock Pi delegation or prompt values.
 result=f.run([flag,'--version']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/\d+\.\d+/);
 result=f.run(['--system-prompt',flag,'--list']);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/auditor/);
});
test('opt-in launches contributed roles, preserves precedence and duplicates, and reports failed factories',t=>{
 const f=fixture(t),promptFile=join(f.dir,'prompt.txt');
 // A provider fixture keeps the final native launch entirely local and request-free.
 put(join(f.agentDir,'extensions/provider.js'),`import {writeFileSync} from 'node:fs';export default function(api){api.registerProvider('fixture',{api:'openai-completions',baseUrl:'http://127.0.0.1:1',apiKey:'fixture',models:[{id:'model',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:1024}]});api.on('session_start',(event,ctx)=>{writeFileSync(${JSON.stringify(promptFile)},ctx.getSystemPrompt());});}`);
 let result=f.run([flag,'auditor','-p','--no-session','--model','fixture/model']);assert.equal(result.status,0,result.stderr);assert.match(readFileSync(promptFile,'utf8'),/CONTRIBUTED_PROMPT/);assert.equal(f.events().filter(name=>name==='contributor').length,2);
 put(join(f.agentDir,'pi-ext-roles/roles/auditor.md'),'---\ncontextFiles: []\noverrideSystemPrompt: true\n---\nGLOBAL_PROMPT');
 result=f.run(['auditor',flag,'-p','--no-session','--model','fixture/model']);assert.equal(result.status,0,result.stderr);assert.match(readFileSync(promptFile,'utf8'),/GLOBAL_PROMPT/);assert.doesNotMatch(readFileSync(promptFile,'utf8'),/CONTRIBUTED_PROMPT/);
 put(join(f.cwd,'.pi/pi-ext-roles/roles/auditor.md'),'---\ncontextFiles: []\noverrideSystemPrompt: true\n---\nPROJECT_PROMPT');
 result=f.run([flag,'auditor','--approve','-p','--no-session','--model','fixture/model']);assert.equal(result.status,0,result.stderr);assert.match(readFileSync(promptFile,'utf8'),/PROJECT_PROMPT/);
 put(join(f.agentDir,'extensions/broken.js'),`throw new Error('BROKEN_DISCOVERY_FIXTURE');`);
 result=f.run([flag,'--list']);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/warning:.*BROKEN_DISCOVERY_FIXTURE/);assert.match(result.stdout,/auditor/);
 result=f.run([flag,'missing-role','-p']);assert.equal(result.status,1);assert.match(result.stderr,/Unknown agent role: missing-role.*some extensions failed to load/);
 // Suppress the broken factory in the final Pi, but still observe its discovery warning.
 put(join(f.agentDir,'pi-ext-roles/roles/auditor.md'),`---\ncontextFiles: []\nextensions: ['!*', '${join(f.agentDir,'extensions/provider.js')}']\n---\nGLOBAL_PROMPT`);
 result=f.run([flag,'auditor','-p','--no-session','--model','fixture/model']);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/warning:.*BROKEN_DISCOVERY_FIXTURE/);
 put(join(f.agentDir,'extensions/duplicate.js'),f.contribution('duplicate',join(f.dir,'duplicate-roles')));
 put(join(f.dir,'duplicate-roles/auditor.md'),'Duplicate');
 result=f.run([flag,'--list']);assert.equal(result.status,1);assert.match(result.stderr,/duplicate|collision|same role/i);
});

test('opt-in discovery exits after list, help, launch and error even when a factory leaks a timer',t=>{
 const f=fixture(t);
 put(join(f.agentDir,'extensions/leak.js'),`export default function(){setInterval(()=>{},1000);}`);
 for(const args of [[flag,'--list'],[flag,'--help'],[flag,'auditor','--version'],[flag,'missing-role','-p']]) {
  const result=f.run(args);assert.equal(result.error,undefined,`${args.join(' ')}: ${result.error}`);
  assert.equal(result.status,args.includes('missing-role')?1:0,result.stderr);
  if(args.includes('--list')||args.includes('--help')) assert.match(result.stdout,/auditor/);
  if(args.includes('--version')) assert.match(result.stdout,/\d+\.\d+/);
 }
});
test('opt-in discovery never installs missing configured packages',t=>{
 const f=fixture(t),calls=join(f.dir,'installer.txt'),bin=join(f.dir,'bin');
 const stub=`#!/bin/sh\necho "$0 $@" >> ${JSON.stringify(calls)}\nexit 1\n`;
 for(const name of ['npm','git']) {put(join(bin,name),stub);chmodSync(join(bin,name),0o755);}
 f.settings.npmCommand=[join(bin,'npm')];
 for(const packages of [['npm:missing-discovery-package@1.0.0'],['git:github.com/example/missing-discovery-package']]) {
  f.settings.packages=[root,...packages];f.save();
  for(const args of [[flag,'--list'],[flag,'--help'],[flag,'auditor','--version']]) {
   const result=f.run(args,{PI_OFFLINE:'',PATH:`${bin}:${process.env.PATH}`});
   assert.equal(result.status,1,`${packages[0]} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
   assert.match(result.stderr,/Missing source/);
  }
 }
 const log=existsSync(calls)?readFileSync(calls,'utf8'):'';
 assert.doesNotMatch(log,/install|clone|fetch/);
 assert.equal(existsSync(join(f.agentDir,'npm')),false);assert.equal(existsSync(join(f.agentDir,'git')),false);assert.equal(existsSync(join(f.cwd,'.pi/npm')),false);assert.equal(existsSync(join(f.cwd,'.pi/git')),false);
});
