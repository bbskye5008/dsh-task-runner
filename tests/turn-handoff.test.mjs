import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRun} from '../runtime/run-config.mjs';
import {registerRun} from '../runtime/profile-store.mjs';
import {Budget} from '../runtime/budget.mjs';
import {handoffTaskLoop,isFinalCompletionPromise} from '../runtime/turn-handoff.mjs';

function fixture(t,{turns=1,phase='active',activation='armed'}={}) {
  const dir=mkdtempSync(join(tmpdir(),'dsh-physical-handoff-')),workspace=join(dir,'workspace');mkdirSync(workspace);
  const run=createRun({workspace,task:'中文跨 turn 任务',verify:'true',rounds:8,minutes:90},join(dir,'runs'));registerRun(run);
  const events=Array.from({length:turns},(_,i)=>({type:'turn/start',seq:i+1,data:{turn:i+1}}));
  const session={id:run.sessionId,header:{cwd:workspace},ownEvents:()=>events};
  const queued=[],agent={session,inbox:{nextStep:[],nextTurn:queued},followup:m=>queued.push(m)};
  run.agent=agent;run.goalId='goal-owned';
  const goal={id:run.goalId,revision:1,objective:run.p.goal.objective,maxGoalRounds:8,phase,activation};run.readGoal=()=>goal;
  run.budget=new Budget({rounds:8,durationMs:60000,onExpire:reason=>{run.status=reason;}});t.after(()=>run.budget.dispose());
  const logs=[];run.log=(type,data)=>logs.push({type,...data});
  return {run,agent,goal,queued,events,logs};
}

test('active Goal handoff leaves next-step and next-turn empty for the native driver',t=>{
  const f=fixture(t),started=f.run.started,deadline=f.run.deadline;
  assert.equal(handoffTaskLoop(f.agent,{id:'next'},2),true);
  assert.deepEqual(f.agent.inbox.nextStep,[]);assert.deepEqual(f.queued,[]);
  assert.equal(f.logs[0].driver,'native_goal');assert.equal(f.logs[0].nextRounds,3);
  assert.equal(f.goal.revision,1);assert.equal(f.goal.activation,'armed');
  assert.equal(f.run.started,started);assert.equal(f.run.deadline,deadline);
});
test('next-turn events retain the same run, Goal and original deadline',t=>{
  const f=fixture(t);handoffTaskLoop(f.agent,{id:'next'},2);f.events.push({type:'turn/end',data:{turn:1,reason:{kind:'completed'}}},{type:'turn/start',seq:3,data:{turn:2}});
  const deadline=f.run.deadline;assert(handoffTaskLoop(f.agent,{id:'again'},3));
  assert.equal(f.logs[1].fromPhysicalTurn,2);assert.equal(f.logs[1].nextRounds,5);assert.equal(f.run.deadline,deadline);assert.equal(f.queued.length,0);
});
test('Goal complete without final certification queues exactly one real next turn',t=>{
  const f=fixture(t,{phase:'complete',activation:'disarmed'});
  assert(handoffTaskLoop(f.agent,{id:'certificate-repair'},2));
  assert(handoffTaskLoop(f.agent,{id:'duplicate'},2));
  assert.deepEqual(f.queued,[{id:'certificate-repair'}]);assert.equal(f.agent.inbox.nextStep.length,0);
  assert.equal(f.logs[0].driver,'certificate_followup');assert.equal(f.goal.phase,'complete');assert.equal(f.goal.revision,1);
});
test('prospective handoff cannot exceed the existing conservative eight-round cap',t=>{
  const f=fixture(t,{turns:4});assert(handoffTaskLoop(f.agent,{id:'forbidden'},5));
  assert.equal(f.run.status,'round_limit');assert.equal(f.queued.length,0);assert.equal(f.logs.length,0);
});
test('wall deadline rejects handoff before a queued wakeup or native delegation',t=>{
  const f=fixture(t);f.run.deadline=Date.now()-1;
  assert.throws(()=>handoffTaskLoop(f.agent,{id:'forbidden'},2),/deadline_expired/);assert.equal(f.queued.length,0);assert.equal(f.logs.length,0);
});
for(const phase of ['paused','blocked'])test('stopped Goal cannot be silently rearmed: '+phase,t=>{
  const f=fixture(t,{phase,activation:'disarmed'});assert.throws(()=>handoffTaskLoop(f.agent,{id:'forbidden'},2),/goal_not_armed/);assert.equal(f.queued.length,0);assert.equal(f.goal.phase,phase);
});
test('disarmed active Goal and mismatched identity fail closed',t=>{
  const f=fixture(t,{activation:'disarmed'});assert.throws(()=>handoffTaskLoop(f.agent,{id:'forbidden'},2),/goal_not_armed/);
  f.goal.id='other-goal';assert.throws(()=>handoffTaskLoop(f.agent,{id:'forbidden'},2),/goal_mismatch/);assert.equal(f.queued.length,0);
});
test('cancelled run and stale Agent cannot hand off',t=>{
  const f=fixture(t);assert.throws(()=>handoffTaskLoop({...f.agent},{id:'forbidden'},2),/agent_mismatch/);
  f.run.status='cancelled';assert.throws(()=>handoffTaskLoop(f.agent,{id:'forbidden'},2),/run_terminal/);assert.equal(f.queued.length,0);
});
test('unbound standalone PUA stays on its original implementation',()=>{
  assert.equal(handoffTaskLoop({session:{id:'unbound'}},{id:'native'},2),false);
});
test('only a final standalone promise requests completion',()=>{
  for(const output of ['<promise>LOOP_DONE</promise>','完成\n<promise>LOOP_DONE</promise>\n','完成\n  <promise> LOOP_DONE </promise>  '])assert(isFinalCompletionPromise(output));
  for(const output of ['没有 <promise>LOOP_DONE</promise>','证书 / `<promise>LOOP_DONE</promise>` | 无','> <promise>LOOP_DONE</promise>','```\n<promise>LOOP_DONE</promise>\n```','<promise>LOOP_DONE</promise>\n仍有剩余任务'])assert.equal(isFinalCompletionPromise(output),false,output);
});
