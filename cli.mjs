#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {parseArgs} from 'node:util';
const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{workspace:{type:'string'},task:{type:'string'},'task-file':{type:'string'},verify:{type:'string'},rounds:{type:'string'},minutes:{type:'string'},freeze:{type:'string',multiple:true},session:{type:'string'},help:{type:'boolean'}}});
if(v.help){console.log('dsh-task --workspace /path --task "任务" --verify "验收命令"\ndsh-task status [ID]\ndsh-task cancel ID\ndsh-task diagnose ID\n默认 8 轮、90 分钟；--rounds/--minutes 只能降低上限。需已安装插件且 Harness 正在运行。');process.exit(0);}
const action=p[0]??'start';if(!['start','status','cancel','diagnose'].includes(action))throw Error('unknown_action');
const input={workspace:v.workspace,task:v.task,taskFile:v['task-file'],verify:v.verify,rounds:v.rounds,minutes:v.minutes,freeze:v.freeze};
try {
  const home=process.env.DSH_TASK_RUNNER_HOME||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'task-runner');
  const control=JSON.parse(readFileSync(join(home,'control.json'),'utf8'));
  const socket=createConnection(control.socketPath);let response='';
  socket.setTimeout(30000,()=>socket.destroy(new Error('controller_timeout')));
  socket.once('connect',()=>socket.write(JSON.stringify({token:control.token,action,id:p[1],fromSession:v.session,input})+'\n'));
  socket.on('data',chunk=>{response+=chunk;if(response.length>1000000)socket.destroy(new Error('response_too_large'));});
  socket.once('error',e=>{console.error('无法连接 Harness Task Runner：'+e.message);process.exitCode=1;});
  socket.once('end',()=>{try{const x=JSON.parse(response);console.log(JSON.stringify(x.ok?x.value:x,null,2));if(!x.ok)process.exitCode=1;}catch(e){console.error('invalid_controller_response');process.exitCode=1;}});
}catch(e){console.error('请先安装 Task Runner 插件并启动 Harness。'+e.message);process.exitCode=1;}
