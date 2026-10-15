import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {createPreparation,savePreparation,readPreparation,writePreparation,publishPreparation,approvedInput,preparationToolDenial,preparationPrompt,assertPreparationSource} from './preparation.mjs';
import {hash,regular} from './profile-store.mjs';

const output={schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]};
export function installPreparationHost(ctx,{home,start,latestOrigin}){
  const preps=new Map(),sessions=new Map(),handles=new Map();
  const get=id=>{if(!preps.has(id)){const p=readPreparation(home,id);preps.set(id,p);sessions.set(p.sessionId,p);}return preps.get(id);};
  const summary=p=>{
    let run=p.run??null;if(run?.id&&/^task-[a-f0-9-]{36}$/.test(run.id))try{run={...run,...JSON.parse(regular(join(home,run.id,'status.json')))};}catch{}
    const status=p.status==='executing'&&run?.status!=='active'?(run?.status==='complete'?'complete':'execution_'+run?.status):p.status;
    return {id:p.id,status,sessionId:p.sessionId,workspace:p.input.workspace,artifactRoot:p.artifactRoot,review:p.review??null,digest:p.digest??null,run,model:p.model??null,loadedSkills:p.loadedSkills??[]};
  };
  // Restored interview sessions remain guarded. They do not silently become
  // ordinary coding agents after a host restart loses their scoped tools.
  const previousRoot=join(home,'preparations');
  if(existsSync(previousRoot))for(const id of readdirSync(previousRoot))if(/^prep-[a-f0-9-]{36}$/.test(id)){
    try{const p=get(id);if(['clarifying','specifying','generating','starting'].includes(p.status)){p.status='interrupted';p.error='host_restarted_create_new_preparation';savePreparation(p);}}catch(e){ctx.logger.warn('Cannot restore preparation %s: %s',id,String(e));}
  }
  const assertSkills=p=>{for(const s of Object.values(p.skills))if(hash(regular(s.path))!==s.sha256)throw Error('specworkflow_skill_changed');};
  const requireSkills=p=>{if(!['to-grill','to-spec'].every(n=>p.loadedSkills.includes(n)))throw Error('load_both_specworkflow_stages_first');};
  const prepare=async(input,origin,signal)=>{
    if(!origin)throw Error('open_a_model_configured_conversation_first');
    const registry=ctx.get('skills');if(!registry)throw Error('specworkflow_skill_registry_missing');
    const skills={};for(const name of ['to-grill','to-spec']){
      const s=await registry.get(name,{cwd:input.workspace,scope:origin,signal});
      if(s?.provider!=='task-runner-specworkflow'||s.resourceBase?.kind!=='directory')throw Error('bundled_specworkflow_stage_unavailable:'+name);
      const path=join(s.resourceBase.path,'SKILL.md');skills[name]={path,sha256:hash(regular(path))};
    }
    const p=createPreparation(input,home);p.skills=skills;p.loadedSkills=[];p.model={...origin.options};preps.set(p.id,p);sessions.set(p.sessionId,p);savePreparation(p);
    try{
      const handle=await ctx.agents.create({sessionId:p.sessionId,meta:{cwd:input.workspace,agentPreset:origin.session.header.agentPreset??'standard'},agentOptions:{...origin.options},signal,setup:async agentCtx=>{
        await ctx.agentPresets.mount(agentCtx,ctx.agentPresets.composedPreset(origin.ctx)??origin.session.header.agentPreset??'standard');
        agentCtx.tools.register(defineTool({name:'task_prepare_write',description:'Write only requirements/specification and acceptance drafts under this preparation artifact directory. Production edits are prohibited.',parameters:{path:{type:'string',required:true},content:{type:'string',required:true}},output,execute:async a=>{
          assertSkills(p);assertPreparationSource(p);
          if(!a.path.endsWith('.md')&&!['generating','awaiting_approval'].includes(p.status))throw Error('finish_spec_then_call_task_prepare_generate_before_writing_acceptance_code');
          return writePreparation(p,a.path,a.content);
        }}));
        agentCtx.tools.register(defineTool({name:'task_prepare_generate',description:'Leave the two no-code SpecWorkflow stages and enter acceptance-script preparation. Requires saved requirements.md and spec.md; still no production implementation.',parameters:{},output,execute:async()=>{
          requireSkills(p);assertPreparationSource(p);
          if(!['clarifying','specifying','generating','awaiting_approval'].includes(p.status))throw Error('preparation_not_editable');
          for(const name of ['requirements.md','spec.md'])if(regular(join(p.artifactRoot,name)).length<80)throw Error('specification_required:'+name);
          p.status='generating';delete p.digest;delete p.review;savePreparation(p);return {status:p.status,next:'Generate real behavioral checks and acceptance.json with task_prepare_write; submit for user review. Do not implement production code.'};
        }}));
        agentCtx.tools.register(defineTool({name:'task_prepare_submit',description:'Validate and publish concrete requirements, specifications and acceptance scripts for human confirmation. Does not run code or authorize execution.',parameters:{},output,execute:async()=>{
          assertSkills(p);requireSkills(p);if(p.status!=='generating'&&p.status!=='awaiting_approval')throw Error('acceptance_generation_stage_required');
          return publishPreparation(p,p.loadedSkills);
        }}));
      }});
      handles.set(p.id,handle);handle.agent.followup(createUserMessage({content:[{type:'text',text:preparationPrompt(p)},{type:'text',text:'澄清问题请用普通会话文本逐个提出，列出选项后结束当前回复并等待回答。不要调用 ask_user_question：本适配器通过普通会话或 dsh-task reply 接收回答。'}],source:{kind:'user'}}));
      return summary(p);
    }catch(e){p.status='startup_error';p.error=String(e);savePreparation(p);throw e;}
  };
  // Monotonic guard applies to nested PTC dispatch too; a model cannot call a
  // shell CLI to approve its own draft or edit production while interviewing.
  ctx.tools.guard(exec=>{
    const p=exec.agent&&sessions.get(String(exec.agent.session.id));if(!p)return;
    const denial=preparationToolDenial(p,exec.name,exec.arguments);if(denial)return denial;
    if(exec.name==='skill'&&exec.arguments?.name==='to-spec'&&(!p.loadedSkills.includes('to-grill')||!existsSync(join(p.artifactRoot,'requirements.md'))))return 'Save the clarified requirements after to-grill before loading to-spec.';
  });
  ctx.on('tools/result',(exec,result)=>{
    const p=exec.agent&&sessions.get(String(exec.agent.session.id));if(!p||!['clarifying','specifying','generating','awaiting_approval'].includes(p.status)||exec.name!=='skill'||result.isError||!['to-grill','to-spec'].includes(exec.arguments?.name))return;
    const name=exec.arguments.name;if(!p.loadedSkills.includes(name))p.loadedSkills.push(name);
    if(name==='to-spec')p.status='specifying';savePreparation(p);
  });
  const approve=async(id,digest,origin,signal)=>{
    const p=get(id);assertSkills(p);const input=approvedInput(p,digest);
    p.status='starting';savePreparation(p);
    try{
      const base=origin??latestOrigin(),source=handles.get(id)?.agent??{ctx:base.ctx,session:base.session,options:p.model};
      const run=await start(input,source,signal);
      p.status='executing';p.run=run;savePreparation(p);return {preparation:summary(p),...run};
    }catch(e){p.status='launch_failed';p.error=String(e);savePreparation(p);throw e;}
  };
  const reply=(id,message)=>{
    const p=get(id),agent=handles.get(id)?.agent;if(!agent)throw Error('preparation_session_not_live');
    if(typeof message!=='string'||!message.trim()||message.length>60000)throw Error('preparation_reply_required');
    if(!['clarifying','specifying','generating','awaiting_approval'].includes(p.status))throw Error('preparation_not_active');
    agent.followup(createUserMessage({content:[{type:'text',text:message}],source:{kind:'user'}}));return summary(p);
  };
  const status=id=>{
    if(id){const p=get(id);return {...summary(p),error:p.error??null,...p.review?{reviewText:readFileSync(p.review,'utf8')}:{}};}
    const root=join(home,'preparations');if(existsSync(root))for(const id of readdirSync(root))if(/^prep-[a-f0-9-]{36}$/.test(id))get(id);
    return [...preps.values()].map(summary);
  };
  const cancel=id=>{const p=get(id);if(p.status==='executing')throw Error('cancel_execution_with_task_id');handles.get(id)?.agent.cancel({kind:'hook',reason:'preparation_cancelled'});p.status='cancelled';savePreparation(p);return summary(p);};
  ctx.effect(()=>async()=>{await Promise.allSettled([...handles.values()].map(h=>h.dispose()));});
  return {prepare,approve,reply,status,cancel};
}
