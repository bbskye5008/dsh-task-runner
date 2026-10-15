import {mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,appendFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {discoverFrozen} from './input.mjs';
import {hash,regular,treeInventory} from './profile-store.mjs';

export const packageRoot=fileURLToPath(new URL('../',import.meta.url));
export function createRun(input,home) {
  const id='task-'+randomUUID(),sessionId='session-'+randomUUID(),started=Date.now(),dir=join(home,id);
  mkdirSync(dir,{recursive:true,mode:0o700});
  const frozen=discoverFrozen(input),objective='完成当前任务、冻结验收与交付（'+id+'）';
  const journal='TASK_GATE_PROGRESS.md',final='TASK_GATE_FINAL.md';
  const protocol=[
    '这是已授权长任务。真实 Goal 已由宿主创建；保持其目标和轮次上限，禁止 clear/rebind/off 或伪造证据。',
    '先调用 context_guard_prepare 读取完整契约和真实 Goal。自主实施，验收失败后在剩余预算内修复。',
    '已有验收测试和配置被冻结；不要修改这些文件。需要新增自测时使用独立 self-tests/ 目录。',
    '实现和自验完成后，写 TASK_GATE_FINAL.md，说明交付、真实验证、限制；至少 80 字节。',
    '随后 context_guard_phase(stage=1,action=verify)，追加 TASK_GATE_PROGRESS.md：真实结果、返回的 verification_id、剩余工作；再 action=record。',
    '所有文件完成后 context_guard_checkpoint(bindings=[]) 获取真实证书；update_goal(action=complete)；Goal revision 改变后再次 checkpoint 重签。',
    '持同一候选、当前 Goal 版本的有效证书才输出 <promise>LOOP_DONE</promise>。文件再变化必须重新验收签证。',
    '需要人工输入则输出 <loop-pause>具体缺少的信息</loop-pause>；无法完成则 <loop-abort>具体原因</loop-abort>，不能声称完成。',
    '冻结验收命令：'+input.verify,
    '冻结工作区路径：'+Object.keys(frozen.lockedFiles).join(', ')
  ].join('\n');
  const root='用户任务原文：\n'+input.task+'\n\n宿主执行协议：\n'+protocol;
  const userMessage=join(dir,'user-message.txt');writeFileSync(userMessage,root);
  const command=input.verify,spec={executable:'/bin/sh',args:['-c',command],command,timeoutMs:120000,requiredChecks:['command']};
  const sources=[{name:'user-task-and-protocol',path:userMessage,sha256:hash(root),bindings:[{start:0,end:root.length,checks:['command','engine-policy']}]}];
  for(const name of ['AGENTS.md','TASK.txt','TASK.md']){const path=join(input.workspace,name);if(frozen.files[path]){const content=regular(path).toString('utf8');if(content.length)sources.push({name,path,sha256:frozen.files[path],bindings:[{start:0,end:content.length,checks:['command','engine-policy']}]});}}
  const p={schema:'dsh-task-gate-profile/v1',id,cwd:input.workspace,goal:{objective,maxRounds:input.rounds},implementation:['.'],implementationExcludes:['.git','node_modules','.scratch',...frozen.lockedTrees],journal,delivery:{files:[final],minBytes:80},phases:[{id:'implementation-and-delivery',name:'实现、独立验收和交付',check:{...spec}}],acceptance:{...spec},sources,lockedFiles:frozen.lockedFiles,lockedTrees:frozen.lockedTrees,lockedTreeInventory:treeInventory(input.workspace,frozen.lockedTrees),dependencies:Object.keys(frozen.files),userMessage,protocol};
  const profile=join(dir,'profile.json');writeFileSync(profile,JSON.stringify(p,null,2)+'\n');
  const run={id,sessionId,dir,p,profileHash:hash(JSON.stringify(p)),verify:input.verify,checkTimeoutMs:120000,started,deadline:started+Math.ceil(input.minutes*60000),status:'active',abort:new AbortController(),frozenFiles:{...frozen.files,[profile]:hash(regular(profile)),[userMessage]:hash(root)},externalTrees:frozen.externalTrees,rootMessage:root};
  const pin=path=>{const st=lstatSync(path);if(st.isDirectory())for(const n of readdirSync(path))pin(join(path,n));else if(st.isFile()&&/\.(?:mjs|js|json)$/.test(path))run.frozenFiles[path]=hash(readFileSync(path));};
  pin(join(packageRoot,'runtime'));pin(join(packageRoot,'vendor'));
  for(const n of ['index.mjs','guard.mjs','package.json'])run.frozenFiles[join(packageRoot,n)]=hash(regular(join(packageRoot,n)));
  run.log=(type,data={})=>{appendFileSync(join(dir,'events.jsonl'),JSON.stringify({...data,at:new Date().toISOString(),session:sessionId,run:id,type})+'\n');};
  run.save=()=>writeFileSync(join(dir,'status.json'),JSON.stringify({id,sessionId,pid:process.pid,workspace:p.cwd,status:run.status,started:run.started,deadline:run.deadline,rounds:run.rounds??0,maxRounds:p.goal.maxRounds,reason:run.reason??null,certificate:run.finalCertificate??null},null,2)+'\n');
  run.log('registered',{profileHash:run.profileHash,deadline:run.deadline,maxRounds:p.goal.maxRounds,frozenFiles:Object.keys(frozen.files),externalTrees:Object.keys(frozen.externalTrees)});run.save();
  return run;
}
