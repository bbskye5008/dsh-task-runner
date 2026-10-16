import {mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,unlinkSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createServer,createConnection} from 'node:net';
import {randomBytes} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {parseInput,inventory} from './runtime/input.mjs';
import {createRun} from './runtime/run-config.mjs';
import {registerRun,runFor,assertRun} from './runtime/profile-store.mjs';
import {Budget} from './runtime/budget.mjs';
import {gate} from './runtime/completion-gate.mjs';
import {existingNativeTask} from './runtime/native-task.mjs';
import {installPreparationHost} from './runtime/preparation-host.mjs';

export const name='task-runner';
export const inject=['agents','commands','goals','sessions','tools','puaConfiguration','taskRunnerHost','agentPresets'];
const text=d=>(d.message??d).content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')??'';
export function apply(ctx) {
  const home=process.env.DSH_TASK_RUNNER_HOME||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'task-runner');
  mkdirSync(home,{recursive:true,mode:0o700});chmodSync(home,0o700);
  const owned=new Map(),pua=ctx.puaConfiguration,live=new Map();
  const stop=(run,reason)=>{
    if(run.status!=='active')return;
    run.status=reason;run.reason=reason;run.abort.abort(new Error(reason));run.budget?.dispose();
    if(run.agent){
      pua.runtime.cancel(run.agent.session);
      try{ctx.goals.disarm(run.agent);const g=ctx.goals.get(run.agent);if(g?.phase==='active')ctx.goals.pause(run.agent,{id:g.id,revision:g.revision});}catch(e){run.log('goal_stop_error',{error:String(e)});}
      run.agent.cancel({kind:'hook',reason:'task-runner:'+reason});
    }
    run.log('stopped',{reason,rounds:run.rounds??0});run.save();
  };
  const readLoop=agent=>pua.runtime.read(agent.session).loop;
  const rounds=(agent,loop)=>Math.max(1,(loop?.iteration??1)+Math.max(0,[...agent.session.ownEvents()].filter(e=>e.type==='turn/start').length-1));
  const snapshot=run=>JSON.parse(readFileSync(join(run.dir,'status.json'),'utf8'));
  const start=async(input,origin,signal)=>{
    signal?.throwIfAborted();
    if(!origin)throw Error('open_a_model_configured_conversation_first');
    if(ctx.taskRunnerHost.qualification.status!=='supported')throw Error('host_qualification_unavailable:'+ctx.taskRunnerHost.qualification.reason);
    if([...live.values()].some(r=>r.status==='active'&&r.p.cwd===input.workspace))throw Error('workspace_already_has_active_run');
    const run=createRun(input,home);registerRun(run);live.set(run.id,run);
    run.budget=new Budget({rounds:input.rounds,durationMs:Math.max(1,run.deadline-Date.now()),onExpire:reason=>stop(run,reason)});
    try {
      const handle=await ctx.agents.create({sessionId:run.sessionId,meta:{cwd:input.workspace,agentPreset:origin?.session.header.agentPreset??'standard'},agentOptions:{...origin.options},signal,setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,ctx.agentPresets.composedPreset(origin.ctx)??origin.session.header.agentPreset??'standard');}});
      run.agent=handle.agent;owned.set(run.id,handle);
      assertRun(run);
      const invoke=async line=>{const result=await ctx.commands.execute(run.agent,line,[],signal??run.abort.signal);if(result?.result.kind!=='success')throw Error(result?.result.text??'required_command_missing');};
      await invoke('/context-guard on');
      const native=existingNativeTask(run.agent);if(native)await native.flush();run.log('guard_after_enable',{base:native?.base(),violations:native?.runtime.projection.integrityViolations,qualification:ctx.taskRunnerHost.qualification});
      const base=native?.base();if(!base||!base.enabled||base.integrity!=='valid'||base.hostStatus!=='supported')throw Error('guard_activation_unavailable:'+JSON.stringify(native?.runtime.projection.integrityViolations));
      await invoke('/pua config '+JSON.stringify({subagents:false,integrityGuard:true,offline:true,maxIterations:input.rounds,verificationTimeout:120}));
      ctx.goals.create(run.agent,{objective:run.p.goal.objective,maxGoalRounds:input.rounds});
      const goal=ctx.goals.get(run.agent);run.goalId=goal.id;run.readGoal=()=>ctx.goals.get(run.agent);run.log('started',{goal,options:run.agent.options,originSession:origin?.id??null});
      await invoke('/pua loop-json '+JSON.stringify({task:'执行已登记长任务 '+run.id+'，先调用 context_guard_prepare 读取完整任务和协议。',maxIterations:input.rounds,verificationTimeout:120,verify:run.p.acceptance.command}));
      run.save();return {...snapshot(run),evidence:run.dir};
    }catch(e){stop(run,'startup_error');run.log('startup_error',{error:String(e)});throw e;}
  };
  const latestOrigin=id=>{
    if(id){const agent=ctx.agents.get(id);if(!agent)throw Error('origin_session_not_live');return agent;}
    return ctx.agents.list().filter(a=>!a.session.header.parentSession).sort((a,b)=>b.session.header.createdAt-a.session.header.createdAt)[0];
  };
  const preparations=installPreparationHost(ctx,{home,start,latestOrigin});
  const launch=(raw,origin,signal)=>{const input=parseInput(raw,{allowPreparation:true,defaultWorkspace:origin?.session.header.cwd});return input.verify===undefined?preparations.prepare(input,origin,signal):start(input,origin,signal);};
  const command=async inv=>{
    try {
      const s=inv.rawInput.trim();
      if(!s||s==='help')return {kind:'success',text:'用法：/task-run --task "想做的事情"，默认使用当前会话工作区；可加 --workspace "/绝对路径" 切换工作区。进入 SpecWorkflow 澄清、规格、验收脚本准备；review PREP_ID 查看待确认版本；approve PREP_ID DIGEST 确认并执行。提供 --verify "独立验收命令" 可直接执行。正式执行最多 8 轮、90 分钟。status [ID] 查看；cancel ID 取消。'};
      if(s==='status'||s.startsWith('status ')){const id=s.slice(6).trim();return {kind:'success',text:JSON.stringify(id?.startsWith('prep-')?preparations.status(id):id?snapshot(live.get(id)??(()=>{throw Error('run_not_live');})()):{runs:[...live.values()].map(snapshot),preparations:preparations.status()},null,2)};}
      if(s.startsWith('review '))return {kind:'success',text:JSON.stringify(preparations.status(s.slice(7).trim()),null,2)};
      if(s.startsWith('approve ')){const [,id,digest,...extra]=s.split(/\s+/);if(extra.length)throw Error('approve_requires_id_and_digest');return {kind:'success',text:'已确认并启动：'+JSON.stringify(await preparations.approve(id,digest,inv.agent,inv.signal))};}
      if(s.startsWith('cancel ')){const id=s.slice(7).trim();if(id.startsWith('prep-'))return {kind:'success',text:JSON.stringify(preparations.cancel(id))};const run=live.get(id);if(!run)throw Error('run_not_live');stop(run,'cancelled');return {kind:'success',text:JSON.stringify(snapshot(run))};}
      const result=await launch(s,inv.agent,inv.signal);return {kind:'success',text:(result.id.startsWith('prep-')?'需求准备已启动：':'长任务已启动：')+JSON.stringify(result)};
    }catch(e){return {kind:'error',text:String(e.message??e)};}
  };
  ctx.commands.register({name:'task-run',description:'使用当前工作区，先澄清需求并准备验收，确认后执行有证书门禁的长任务，最多 8 轮、90 分钟',input:{hint:'--task "任务" [--workspace "/绝对路径"] [--verify "验收命令"]'},handler:command});
  const diagnose=run=>{const native=run.agent&&existingNativeTask(run.agent);return {status:snapshot(run),guard:native?{base:native.base(),violations:native.runtime.projection.integrityViolations,activation:native.runtime.activationDiagnostic}:null,qualification:ctx.taskRunnerHost.qualification};};
  ctx.on('agent/pre-step',async({agent},next)=>{
    const run=runFor(agent.session);if(!run)return next();
    if(run.status!=='active'){agent.cancel({kind:'hook',reason:'task-runner:terminal'});return {kind:'reject'};}
    const loop=readLoop(agent);run.rounds=rounds(agent,loop);
    if(!run.budget.check(run.rounds))return {kind:'reject'};
    try {
      assertRun(run);
      for(const [path,expected]of Object.entries(run.externalTrees))if(JSON.stringify(inventory(path))!==JSON.stringify(expected))throw Error('external_acceptance_tree_changed');
      const decision=await next();if(decision.kind!=='enter')return decision;
      assertRun(run);
      const roots=[...agent.session.ownEvents()].filter(e=>e.type==='user/message'&&e.data.source?.kind==='user');
      if(roots.length===0)decision.messages.push(createUserMessage({content:[{type:'text',text:run.rootMessage}],source:{kind:'user'}}));
      run.save();return decision;
    }catch(e){run.log('admission_rejected',{error:String(e)});stop(run,'integrity_error');return {kind:'reject'};}
  });
  ctx.on('tools/pre-execute',async(exec,next)=>{
    const run=exec.agent&&runFor(exec.agent.session);if(!run)return next();
    if(run.status!=='active'||!run.budget.check(run.rounds??1))return {kind:'deny',reason:'Task Runner stopped: '+run.status};
    try{assertRun(run);}catch(e){stop(run,'integrity_error');return {kind:'deny',reason:String(e)};}
    if(['context_guard_phase','context_guard_checkpoint'].includes(exec.name))run.requestSignal=exec.signal;
    return next();
  });
  ctx.on('agent/turn-stopping',({agent})=>{
    const run=runFor(agent.session);if(!run||run.status!=='active')return;
    const loop=readLoop(agent);run.rounds=rounds(agent,loop);
    if(loop?.status==='complete'){
      const verdict=gate.check(agent.session);
      if(!verdict.ok||ctx.goals.get(agent)?.phase!=='complete'){stop(run,'uncertified_completion');return;}
      if(!run.budget.finish()){stop(run,'deadline');return;}
      run.finalCertificate=verdict.certificate;run.status='complete';run.log('completed',{...verdict,rounds:run.rounds});run.save();
    }else if(['max_reached','cancelled','paused'].includes(loop?.status))stop(run,loop.status==='max_reached'?'round_limit':loop.status);
    else if(!run.budget.check(run.rounds))return;
  });
  ctx.on('session/event',(session,event)=>{
    const run=runFor(session);if(!run||run.status!=='active'||event.type!=='turn/end')return;
    if(event.data?.reason?.kind==='aborted'&&event.data.reason.reason?.kind==='user')stop(run,'cancelled');
  });
  ctx.on('agent/error',({agent,error})=>{const run=runFor(agent.session);if(run?.status==='active'){run.log('agent_error',{error:String(error)});stop(run,'agent_error');}});
  ctx.on('agent/disposed',({agent})=>{const run=runFor(agent.session);if(run?.status==='active')stop(run,'interrupted');});
  // Process restart never restores a previous process's certificate or budget.
  for(const entry of readdirSync(home,{withFileTypes:true})){
    if(!entry.isDirectory())continue;const path=join(home,entry.name,'status.json');
    try{const s=JSON.parse(readFileSync(path,'utf8'));let ownerAlive=false;try{if(s.pid&&s.pid!==process.pid){process.kill(s.pid,0);ownerAlive=true;}}catch{}if(s.status==='active'&&!ownerAlive){s.status='interrupted';s.reason='host_restarted_requires_explicit_new_run';writeFileSync(path,JSON.stringify(s,null,2)+'\n');}}catch{}
  }
  const socketPath=join(home,'control.sock'),receipt=join(home,'control.json'),token=randomBytes(32).toString('hex');
  const server=createServer(socket=>{
    let buffer='';socket.setTimeout(15000,()=>socket.destroy());
    socket.on('data',async chunk=>{
      buffer+=chunk;if(buffer.length>300000){socket.destroy();return;}if(!buffer.includes('\n'))return;
      socket.pause();
      try{
        const req=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));if(req.token!==token)throw Error('unauthorized_local_request');
        if(req.id&&!/^(task|prep)-[a-f0-9-]{36}$/.test(req.id))throw Error('invalid_run_id');
        let value;
        if(req.action==='start')value=await launch(JSON.stringify(req.input),latestOrigin(req.fromSession));
        else if(req.action==='approve')value=await preparations.approve(req.id,req.digest,latestOrigin(req.fromSession));
        else if(req.action==='reply')value=preparations.reply(req.id,req.message);
        else if(req.action==='review')value=preparations.status(req.id);
        else if(req.action==='diagnose'){const run=live.get(req.id);if(!run)throw Error('run_not_live');value=diagnose(run);}
        else if(req.action==='status')value=req.id?.startsWith('prep-')?preparations.status(req.id):req.id?(live.has(req.id)?snapshot(live.get(req.id)):JSON.parse(readFileSync(join(home,req.id,'status.json'),'utf8'))):{runs:[...live.values()].map(snapshot),preparations:preparations.status()};
        else if(req.action==='cancel'){if(req.id.startsWith('prep-'))value=preparations.cancel(req.id);else{const run=live.get(req.id);if(!run)throw Error('run_not_live');stop(run,'cancelled');value=snapshot(run);}}
        else throw Error('unknown_action');
        socket.end(JSON.stringify({ok:true,value})+'\n');
      }catch(e){socket.end(JSON.stringify({ok:false,error:String(e.message??e)})+'\n');}
    });
  });
  // Refuse to replace a live controller owned by another Host process.
  const listen=()=>server.listen(socketPath,()=>{chmodSync(socketPath,0o600);writeFileSync(receipt,JSON.stringify({socketPath,token,pid:process.pid})+'\n',{mode:0o600});});
  if(existsSync(socketPath)){
    const probe=createConnection(socketPath);probe.once('connect',()=>{probe.destroy();ctx.logger.error('Task Runner controller already running; CLI controller not replaced.');});probe.once('error',()=>{try{unlinkSync(socketPath);}catch{}listen();});
  }else listen();
  server.on('error',e=>ctx.logger.error('Task Runner controller: %s',String(e)));
  ctx.effect(()=>async()=>{
    for(const run of live.values())if(run.status==='active')stop(run,'interrupted');
    server.close();
    try{const current=JSON.parse(readFileSync(receipt,'utf8'));if(current.token===token){unlinkSync(receipt);try{unlinkSync(socketPath);}catch{}}}catch{}
    await Promise.allSettled([...owned.values()].map(h=>h.dispose()));
  });
}
