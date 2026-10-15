import {readFileSync,readdirSync,lstatSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {profileFor,registry,regular,within,hash,treeInventory} from './profile-store.mjs';
import {TaskAuthority} from './authority.mjs';
import {executeAcceptance} from './acceptance.mjs';
import {assertRun,runForProfile} from './profile-store.mjs';
import {gate,candidateDigest} from './completion-gate.mjs';

const active=new WeakMap();
const text=d=>(d.message??d).content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')??'';
const output={schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]};
const clean=x=>JSON.parse(JSON.stringify(x));
export function implementationDigest(p){
  const rows=[];
  const excluded=[...(p.implementationExcludes??[]),p.journal,...p.delivery.files,...Object.keys(p.lockedFiles)].map(n=>within(p.cwd,n));
  const visit=(file)=>{if(excluded.some(x=>file===x||file.startsWith(x+'/')))return;const st=lstatSync(file);if(st.isSymbolicLink())throw Error('implementation_symlink');
    if(st.isDirectory()){for(const n of readdirSync(file).sort())if(!['__pycache__','.git','node_modules','.scratch','.pytest_cache','.mypy_cache','.ruff_cache'].includes(n))visit(join(file,n));}
    else if(st.isFile())rows.push([file.slice(p.cwd.length),hash(readFileSync(file))]);else throw Error('implementation_entry');};
  for(const path of [...p.implementation].sort()){const file=within(p.cwd,path);try{visit(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return hash(JSON.stringify(rows));
}
export async function runTrusted(p,spec,label){
 const run=runForProfile(p);assertRun(run);const before=candidateDigest(p.cwd);
 const result=await executeAcceptance(run,label);assertRun(run);
 if(candidateDigest(p.cwd)!==before)throw Error('candidate_changed_during_check');
 return {ok:result.ok,candidate:before,failures:result.ok?[]:['command'],report:{protocol:'task-gate-check/v1',ok:result.ok,checks:[{id:'command',ok:result.ok,detail:result}]},exit:result.exitCode,timedOut:result.timedOut};
}

export class ConfiguredTask {
  constructor(agent,runtime,flush,p){
    this.agent=agent;this.session=agent.session;this.runtime=runtime;this.flush=flush;this.p=p;
    this.authority=new TaskAuthority();this.phases=[];this.pending=new Map();this.initialized=false;
    this.contractDigest=hash(JSON.stringify(p));
  }
  events(){return this.session.snapshotEvents();}
  goal(){return this.events().filter(e=>e.type==='goal/change').at(-1)?.data?.goal;}
  log(type,data={}){gate.record(this.session,'task_'+type,{profile:this.p.id,...data});}
  base(){this.runtime.sync({revalidateHostLock:true});const p=this.runtime.projection;return {enabled:p.enabled,integrity:p.integrity,hostStatus:p.hostStatus,epoch:p.epoch,sessionRefDigest:p.sessionRefDigest,hostLockDigest:p.hostLockDigest,contractRevision:this.contractDigest,currentGoalRef:p.currentGoalRef,rootLocatorIdentity:this.contractDigest};}
  identity(b=this.base()){const g=this.goal();return {session:String(this.session.id),candidate:candidateDigest(this.p.cwd),contract:this.contractDigest,epoch:String(b.epoch),host:b.hostLockDigest,goal:{id:g?.id??'',revision:g?.revision??-1}};}
  view(){const b=this.base();return {...b,currentCertificate:this.authority.current(this.identity(b))&&this.sourceValid()&&!this.constraints().length,certificateReason:'configured_contract_missing_or_stale',certificateDigest:this.authority.read()?.digest,goalPhase:this.goal()?.phase,certificateProtocol:'native-file-contract/v1'};}
  sourceValid(){try{
    registry().assertIntegrity(this.p);
    for(const s of this.p.sources)if(hash(regular(s.path))!==s.sha256)return false;
    for(const [path,digest]of Object.entries(this.p.lockedFiles))if(hash(regular(within(this.p.cwd,path)))!==digest)return false;
    if(this.p.lockedTrees?.length&&JSON.stringify(treeInventory(this.p.cwd,this.p.lockedTrees))!==JSON.stringify(this.p.lockedTreeInventory))return false;
    const actual=this.events().filter(e=>e.type==='user/message'&&e.data.source?.kind==='user').map(e=>text(e.data).trim());
    return actual.length===1&&actual[0]===regular(this.p.userMessage).toString('utf8').trim();
  }catch{return false;}}
  operationDenial(name,a={}){
    if(/agent|subagent|network|web_|fetch_url|plugin_manager/i.test(name))return 'extra_agent_or_network';
    if(/context_guard_(?:rebind|boundary|action|release)/.test(name))return 'contract_rewrite';
    // Inspect operation fields, never prose/source-code bodies. This avoids
    // mistaking URL or absolute-path test strings for actual external actions.
    for(const k of ['path','file_path','filename','cwd','workdir'])if(typeof a[k]==='string'){try{within(this.p.cwd,a[k]);}catch{return 'outside_workspace_path';}}
    if(name==='bash'||name==='exec_command'){
      const cmd=String(a.command??a.cmd??'');
      if(/(?:^|[\s;&|])(?:curl|wget|pip3?|sleep)(?:\s|$)|\bgit\s+(?:commit|push|fetch|pull)\b/.test(cmd))return 'outside_workflow_command';
      for(const m of cmd.matchAll(/(?:^|[\s"'=])(\/(?:Users|private|tmp|var|Applications)[^\s"';]*)/g))if(m[1]!==this.p.cwd&&!m[1].startsWith(this.p.cwd+'/'))return 'outside_workspace_command';

    }
  }
  constraints(){const es=this.events(),results=new Map(es.filter(e=>e.type==='tool/result').map(e=>[e.data.message?.toolCallId,text(e.data)]));const out=[];
    for(const e of es.filter(e=>e.type==='tool/call')){const d=e.data,a=typeof d.arguments==='string'?JSON.parse(d.arguments):d.arguments;if(results.get(d.callId)?.includes('Task gate denial'))continue;const why=this.operationDenial(d.name,a);if(why)out.push({seq:e.seq,reason:why});}return out;}
  toolDenial(name,a){const why=this.operationDenial(name,a);if(why)return 'Task gate denial ['+why+']';
    if(name==='update_goal'&&a?.action==='complete'){const g=this.goal();if(a.goal_id!==g?.id||a.revision!==g?.revision)return 'Task gate denial [stale_goal_ref]';const v=gate.check(this.session);this.log('goal_check',v);if(!v.ok)return 'Task gate denial ['+v.reason+']: current certificate and same-candidate acceptance required.';}}
  pauseRequested(){const es=this.events();const last=es.filter(e=>e.type==='assistant/message').at(-1);if(last&&/<loop-pause>[\s\S]*?<\/loop-pause>/.test(text(last.data)))return true;
    const raw=es.filter(e=>e.type==='user/message'&&e.data.source?.kind==='plugin:@michengai/dsh-pua/runtime').map(e=>text(e.data)).filter(x=>x.startsWith('PUA_RUNTIME_V1 ')).at(-1);
    try{const l=JSON.parse(raw.split('\n')[0].slice(15)).loop;return ['paused','cancelled','max_reached'].includes(l.status)||(l.iteration>=l.maxIterations&&this.goal()?.phase!=='complete');}catch{return false;}}
  async phase(a){await this.flush();const stage=a.stage,p=this.p;
    if(!Number.isInteger(stage)||stage!==this.phases.length+1||stage>p.phases.length)return {status:'rejected',reason:'stage_order',next_stage:this.phases.length+1};
    if(!this.sourceValid())return {status:'rejected',reason:'source_mismatch'};
    const journal=()=>{try{return regular(within(p.cwd,p.journal)).toString('utf8');}catch{return '';}};
    if(this.phases.length&&!journal().startsWith(this.phases.at(-1).journal))return {status:'rejected',reason:'recorded_journal_prefix_changed'};
    if(a.action==='verify'){
      const check=await runTrusted(p,p.phases[stage-1].check,'phase-'+stage);this.log('check',{stage,...check});
      if(!check.ok)return {status:'rejected',stage,failures:check.failures,evidence:check.report};
      const e={stage,id:randomUUID(),checkedAt:Date.now(),implementation:implementationDigest(p),journal:journal(),candidate:check.candidate,checkIds:p.phases[stage-1].check.requiredChecks};
      this.pending.set(e.id,e);this.log('phase_verified',{...e,journal:hash(e.journal)});return {status:'verified',stage,verification_id:e.id,evidence:check.report,next:'APPEND a new truthful journal entry with this id, results, and remaining work; then record. Do not rewrite prior bytes.'};
    }
    if(a.action==='record'){
      const e=this.pending.get(a.verification_id),j=journal();if(!e||e.implementation!==implementationDigest(p))return {status:'rejected',reason:'missing_or_changed_evidence'};
      const added=e&&j.slice(e.journal.length);if(!j.startsWith(e.journal)||!added.includes(e.id)||!/剩余|阻塞|remaining|blocker/i.test(added))return {status:'rejected',reason:'append_truthful_journal_required',next:'Verify again, APPEND the returned id and remaining work without rewriting existing journal bytes, then record.'};
      const saved={...e,recordedAt:Date.now(),journal:j};this.phases.push(saved);this.pending.clear();this.log('phase_recorded',{...saved,journal:hash(j)});return {status:'recorded',stage,next_stage:stage<p.phases.length?stage+1:null};
    }return {status:'rejected',reason:'use_verify_or_record'};
  }
  prepare(){const verdict=gate.check(this.session);this.log('completion_probe',verdict);return {status:'configured_file_contract',protocol:'native-file-contract/v1',profile:this.p.id,contract_digest:this.contractDigest,source_coverage:this.p.sources.map(({name,sha256,bindings})=>({name,sha256,bindings})),phases:this.p.phases.map(({id,name},i)=>({stage:i+1,id,name})),phases_recorded:this.phases.length,source_valid:this.sourceValid(),goal:this.goal(),expected_goal:this.p.goal,current_completion_gate:verdict,constraints:this.constraints(),instructions:this.p.protocol};}
  async checkpoint(){await this.flush();let check;
    const result=await gate.verify(this.session,this.p.acceptance.command,async()=>{check=await runTrusted(this.p,this.p.acceptance,'checkpoint');this.log('check',{...check});return {ok:check.ok,detail:JSON.stringify(check.report)};});
    const b=this.base(),g=this.goal(),id=this.identity(b),receipt=gate.state(this.session).receipt;
    const phases=this.phases.length===this.p.phases.length&&this.phases.every((e,i)=>e.stage===i+1&&(i===0||e.checkedAt>this.phases[i-1].recordedAt));
    let delivery=false,journal=false;try{delivery=this.p.delivery.files.every(n=>regular(within(this.p.cwd,n)).length>=this.p.delivery.minBytes);journal=phases&&regular(within(this.p.cwd,this.p.journal)).toString('utf8').startsWith(this.phases.at(-1).journal);}catch{}
    const facts={identity:id,hostValid:b.integrity==='valid'&&b.hostStatus==='supported',enabled:b.enabled,sourceValid:this.sourceValid(),oracle:!!receipt&&receipt.candidate===id.candidate&&receipt.identity===gate.identity(this.session,this.view()),phases:phases&&journal,checks:!!check?.ok,delivery,constraints:!this.constraints().length,goalValid:g?.objective===this.p.goal.objective&&g?.maxGoalRounds===this.p.goal.maxRounds&&['active','complete'].includes(g?.phase)};
    const cert=this.authority.certify(facts);this.log('certificate_decision',{facts,certificate:cert.certificate,blockers:cert.blockers,acceptance:result});
    return cert.certificate?{status:'certified',protocol:'native-file-contract/v1',certificate:{certification_digest:cert.certificate.digest,...cert.certificate},next:g.phase==='complete'?'Do not change candidate files. Submit LOOP_DONE.':'Complete the current Goal; its revision change invalidates this certificate. Checkpoint again before LOOP_DONE.'}:{status:'not_issued',protocol:'native-file-contract/v1',blockers:cert.blockers,oracle:result,expected_goal:this.p.goal};
  }
  wrapTool(tool){if(tool.name==='context_guard_prepare')return {...tool,output,execute:async()=>{await this.flush();return clean(this.prepare());}};
    if(tool.name==='context_guard_checkpoint')return gate.wrapCheckpoint(this.session,{...tool,output,execute:async()=>clean(await this.checkpoint())});return tool;}
  phaseTool(){return {name:'context_guard_phase',description:'Verify and record the configured ordered phases. Stage count and checks come from the frozen task profile.',parameters:{stage:{type:'number',required:true},action:{type:'string',enum:['verify','record'],required:true},verification_id:{type:'string'}},output,execute:async a=>{try{return clean(await this.phase(a));}catch(e){this.log('phase_error',{reason:String(e)});return {status:'rejected',reason:String(e)};}}};}
}
export function nativeTaskFor(agent,runtime,flush){const p=profileFor(agent.session.header.cwd,agent.session.id);if(!p)return;let task=active.get(agent.session);if(!task){task=new ConfiguredTask(agent,runtime,flush,p);active.set(agent.session,task);}return task;}
export function existingNativeTask(agent){return active.get(agent.session);}
