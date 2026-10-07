import os, tempfile, pathlib, json, pty, subprocess, select, time, fcntl, termios, struct, re, shutil
root=str(pathlib.Path(__file__).resolve().parent.parent)
dir=tempfile.mkdtemp(prefix='pi-role-terminal-')
try:
 cwd=pathlib.Path(dir)/'project'; agent=pathlib.Path(dir)/'agent'; cwd.mkdir(); (agent/'extensions').mkdir(parents=True); (agent/'pi-ext-roles/roles').mkdir(parents=True)
 (agent/'settings.json').write_text(json.dumps({'defaultProvider':'fixture','defaultModel':'model','cacheWarming':'off','theme':'dark','extensions':['-builtin:mcp','-builtin:codemode','-builtin:tool-search','-builtin:llama.cpp'],'defaultProjectTrust':'never'}))
 (agent/'SYSTEM.md').write_text('BASE_TERMINAL')
 (agent/'pi-ext-roles/roles/fixture.md').write_text('---\nmodel: fixture/model:medium\ntools: ["!*", "read"]\ncontextFiles: []\nextensionSettings: {"fixture":true}\n---\nSELECTED_TERMINAL_ROLE')
 log=pathlib.Path(dir)/'events.jsonl'
 (agent/'extensions/fixture.js').write_text('''import {appendFileSync} from 'node:fs';
export default function(api) {
const log=value=>appendFileSync(%s,JSON.stringify(value)+'\\n');log({type:'factory'});
api.registerProvider('fixture',{api:'openai-completions',baseUrl:'http://127.0.0.1:1',apiKey:'fixture',models:[{id:'model',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:1024}]});
api.on('session_start',(event,ctx)=>log({type:'start',prompt:ctx.getSystemPrompt(),tools:api.getActiveTools(),settings:event.settings}));api.on('session_shutdown',()=>log({type:'shutdown'}));}
''' % json.dumps(str(log)))
 env={**os.environ,'PI_OFFLINE':'1','PI_CODING_AGENT_DIR':str(agent),'HOME':dir,'XDG_CACHE_HOME':dir+'/cache','TERM':'xterm-256color'}
 for selected,mode in [(True,"regular"),(False,"regular"),(True,"fullscreen")]:
  if log.exists():log.unlink()
  master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
  args=['node',root+'/dist/cli.js']+(['fixture'] if selected else [])+['--no-session','--tui-mode',mode]
  p=subprocess.Popen(args,cwd=cwd,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave)
  output=b'';sent=False;deadline=time.monotonic()+25
  try:
   while time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],max(0,deadline-time.monotonic()))
    if not ready:break
    try:data=os.read(master,65536)
    except OSError:break
    if not data:break
    output+=data
    events=[json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    if not sent and any(e['type']=='start' for e in events) and b'fixture' in output and b'\x1b[?2004h' in output:
     os.write(master,b'\x04');sent=True
   code=p.wait(timeout=5)
   events=[json.loads(line) for line in log.read_text().splitlines()]
   assert sent and code==0,(selected,code,output[-3000:])
   assert [e['type'] for e in events]==['factory','start','shutdown'],events
   start=events[1]
   assert ('SELECTED_TERMINAL_ROLE' in start['prompt'])==selected
   assert 'BASE_TERMINAL' in start['prompt']
   if selected: assert start['tools']==['read'] and 'settings' not in start
   else: assert 'settings' not in start and set(['read','bash','edit','write']).issubset(start['tools'])
   text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',output.decode(errors='replace'))
   print(json.dumps({'selected':selected,'mode':mode,'exit':code,'bytes_rendered':len(output),'lifecycle':[e['type'] for e in events],'tools':start['tools']}))
  finally:
   if p.poll() is None:p.kill();p.wait()
   os.close(master)
finally:shutil.rmtree(dir)
