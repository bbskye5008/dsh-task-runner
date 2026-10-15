#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {parseArgs} from 'node:util';
const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{workspace:{type:'string'},task:{type:'string'},'task-file':{type:'string'},verify:{type:'string'},rounds:{type:'string'},minutes:{type:'string'},freeze:{type:'string',multiple:true},session:{type:'string'},help:{type:'boolean'}}});
if(v.help){console.log('dsh-task --task "想做的事情" [--workspace /path] [--verify "已有验收命令"]\n工作区默认使用当前终端目录；--workspace 可指定其他绝对路径。\n不提供 --verify：进入 SpecWorkflow 澄清、规格和验收脚本准备。\ndsh-task review PREP_ID\ndsh-task reply PREP_ID "回答或修改意见"\ndsh-task approve PREP_ID DIGEST\ndsh-task status [ID]\ndsh-task cancel ID\ndsh-task diagnose ID\n确认后正式执行，默认最多 8 轮、90 分钟；--rounds/--minutes 只能降低上限。需 Harness 正在运行。');process.exit(0);}
const action=p[0]??'start';if(!['start','status','cancel','diagnose','review','reply','approve'].includes(action))throw Error('unknown_action');
const input={workspace:v.workspace??(action==='start'?process.cwd():undefined),task:v.task,taskFile:v['task-file'],verify:v.verify,rounds:v.rounds,minutes:v.minutes,freeze:v.freeze};
try {
  const home=process.env.DSH_TASK_RUNNER_HOME||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'task-runner');
  const control=JSON.parse(readFileSync(join(home,'control.json'),'utf8'));
  const socket=createConnection(control.socketPath);let response='';
  socket.setTimeout(30000,()=>socket.destroy(new Error('controller_timeout')));
  socket.once('connect',()=>socket.write(JSON.stringify({token:control.token,action,id:p[1],digest:p[2],message:p[2],fromSession:v.session,input})+'\n'));
  socket.on('data',chunk=>{response+=chunk;if(response.length>1000000)socket.destroy(new Error('response_too_large'));});
  socket.once('error',e=>{console.error('无法连接 Harness Task Runner：'+e.message);process.exitCode=1;});
  socket.once('end',()=>{try{const x=JSON.parse(response);console.log(JSON.stringify(x.ok?x.value:x,null,2));if(!x.ok)process.exitCode=1;}catch(e){console.error('invalid_controller_response');process.exitCode=1;}});
}catch(e){console.error('请先安装 Task Runner 插件并启动 Harness。'+e.message);process.exitCode=1;}
