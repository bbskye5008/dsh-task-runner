import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseInput,discoverFrozen} from '../runtime/input.mjs';
import {createRun} from '../runtime/run-config.mjs';
import {assertRun,registerRun,loadTombstones,runFor,profileFor} from '../runtime/profile-store.mjs';
import {Budget,MAX_DURATION_MS,MAX_ROUNDS} from '../runtime/budget.mjs';
import {executeAcceptance} from '../runtime/acceptance.mjs';
import {ConfiguredTask} from '../runtime/native-task.mjs';
import {gate,candidateDigest} from '../runtime/completion-gate.mjs';
const fixture=(verify='true')=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-task-runner-')),workspace=join(dir,'工作 区');mkdirSync(workspace);
 const input=parseInput(JSON.stringify({workspace,task:'完成中文任务和真实验收',verify}));
 return {dir,workspace,input,run(){const r=createRun(input,join(dir,'runs'));registerRun(r);return r;}};
};
test('three inputs default to exactly 8 rounds and 90 minutes',()=>{
 const f=fixture();assert.equal(f.input.rounds,8);assert.equal(f.input.minutes,90);const r=f.run();assert.equal(r.deadline-r.started,MAX_DURATION_MS);assertRun(r);
});
test('shell-style input preserves Chinese spaces and quoted verification command',()=>{
 const f=fixture();const x=parseInput('--workspace "'+f.workspace+'" --task "含 空格的中文任务" --verify "python3 -c \'print(1)\'"');
 assert.equal(x.task,'含 空格的中文任务');assert.equal(x.verify,"python3 -c 'print(1)'");
});
test('omitted workspace uses the invoking session directory for preparation and direct execution',()=>{
 const f=fixture();
 for(const raw of ['--task "中文任务"',JSON.stringify({task:'中文任务'})]){
  const input=parseInput(raw,{allowPreparation:true,defaultWorkspace:f.workspace});
  assert.equal(input.workspace,realpathSync(f.workspace));assert.equal(input.verify,undefined);
  assert.equal(input.rounds,8);assert.equal(input.minutes,90);
 }
 assert.equal(parseInput('--task "中文任务" --verify "true"',{defaultWorkspace:f.workspace}).workspace,realpathSync(f.workspace));
});
test('explicit workspace overrides the session default and invalid explicit paths never fall back',()=>{
 const f=fixture(),other=join(f.dir,'其他 工作区');mkdirSync(other);
 assert.equal(parseInput(JSON.stringify({workspace:other,task:'中文任务',verify:'true'}),{defaultWorkspace:f.workspace}).workspace,realpathSync(other));
 for(const workspace of ['',null,42,'.',join(f.dir,'missing')])assert.throws(()=>parseInput(JSON.stringify({workspace,task:'中文任务',verify:'true'}),{defaultWorkspace:f.workspace}));
});
test('missing session workspace fails clearly instead of using the Host process directory',()=>{
 assert.throws(()=>parseInput('--task "中文任务" --verify "true"'),/current_workspace_unavailable/);
 for(const defaultWorkspace of ['',null,'.'])assert.throws(()=>parseInput('--task "中文任务" --verify "true"',{defaultWorkspace}),/absolute_workspace_required/);
});
for(const change of [{rounds:9},{rounds:0},{minutes:91},{minutes:0},{unexpected:true},{verify:'if then'}])test('invalid or expanded budget fails before a run '+JSON.stringify(change),()=>{
 const f=fixture();assert.throws(()=>parseInput(JSON.stringify({...f.input,...change})));
});
test('malformed JSON is rejected without interpretation',()=>assert.throws(()=>parseInput('{"workspace":invalid}')));
test('budget boundary rejects round 9 and does not reset its start',()=>{
 let now=100,expired=[],timer;const b=new Budget({now:()=>now,onExpire:r=>expired.push(r),setTimer:fn=>(timer=fn,0),clearTimer:()=>{}});
 assert.equal(b.deadline,100+MAX_DURATION_MS);assert(b.check(8));now=200;assert(!b.check(9));assert.deepEqual(expired,['round_limit']);assert.equal(b.deadline,100+MAX_DURATION_MS);timer();assert.equal(expired.length,1);
});
test('wall deadline expires even with no next model step',()=>{
 let now=0,callback,reason;const b=new Budget({durationMs:20,now:()=>now,onExpire:r=>reason=r,setTimer:fn=>(callback=fn,0),clearTimer:()=>{}});
 now=20;callback();assert.equal(reason,'deadline');assert.equal(b.finish(),false);
});
test('completion is rejected after deadline even if timer callback has not fired',()=>{
 let now=0,reason;const b=new Budget({durationMs:10,now:()=>now,onExpire:r=>reason=r,setTimer:()=>0,clearTimer:()=>{}});now=11;assert(!b.finish());assert.equal(reason,'deadline');
});
test('explicit smaller caps work and larger caps cannot be constructed',()=>{
 assert.throws(()=>new Budget({rounds:MAX_ROUNDS+1}));assert.throws(()=>new Budget({durationMs:MAX_DURATION_MS+1}));
 const b=new Budget({rounds:2,durationMs:50,onExpire:()=>{}});assert.equal(b.maxRounds,2);b.dispose();
});
test('acceptance command runs in an independent snapshot',async()=>{
 const f=fixture("printf generated > artifact.txt");writeFileSync(join(f.workspace,'source.txt'),'original');const r=f.run(),before=candidateDigest(f.workspace);
 const x=await executeAcceptance(r);assert(x.ok);assert.notEqual(x.snapshot,f.workspace);assert(!existsSync(join(f.workspace,'artifact.txt')));assert.equal(candidateDigest(f.workspace),before);assert.equal(readFileSync(join(x.snapshot,'artifact.txt'),'utf8'),'generated');
});
test('temporary verifier clones stay outside the candidate and cannot recursively copy themselves',async()=>{
 const f=fixture('python3 clone_check.py');
 writeFileSync(join(f.workspace,'clone_check.py'),"import pathlib, shutil, tempfile\nwith tempfile.TemporaryDirectory() as tmp:\n    target = pathlib.Path(tmp) / 'clone'\n    assert pathlib.Path.cwd().resolve() not in target.resolve().parents, 'temporary clone is inside candidate'\n    shutil.copytree(pathlib.Path.cwd(), target)\n    assert (target / 'clone_check.py').is_file()\n");
 const r=f.run(),before=candidateDigest(f.workspace),result=await executeAcceptance(r);
 assert.equal(result.ok,true,result.stderr);assert.equal(candidateDigest(f.workspace),before);
});
test('nonzero exit cannot be overridden by printed pass text',async()=>{
 const f=fixture('printf "TASK_GATE_RESULT true"; exit 7');const x=await executeAcceptance(f.run());assert(!x.ok);assert.equal(x.exitCode,7);
});
test('verification timeout kills the shell process group',async()=>{
 const f=fixture("python3 -c 'import time;time.sleep(30)'");const r=f.run();r.checkTimeoutMs=60;const start=Date.now();const x=await executeAcceptance(r);assert(!x.ok);assert(x.timedOut);assert(Date.now()-start<2500);
});
test('explicit cancellation interrupts a running verifier',async()=>{
 const f=fixture("python3 -c 'import time;time.sleep(30)'");const r=f.run(),abort=new AbortController();const promise=executeAcceptance(r,'cancel',abort.signal);setTimeout(()=>abort.abort(),100);const x=await promise;assert(!x.ok);assert(Date.now()-r.started<2500);
});
test('baseline test files and directory inventory are frozen',()=>{
 const f=fixture();mkdirSync(join(f.workspace,'tests'));writeFileSync(join(f.workspace,'tests','test_a.py'),'# original');const r=f.run();writeFileSync(join(f.workspace,'tests','conftest.py'),'# added');assert.throws(()=>assertRun(r),/locked_tree_inventory/);
});
test('external checker siblings are bound including later-added helpers',()=>{
 const f=fixture(),check=join(f.dir,'evaluator');mkdirSync(check);writeFileSync(join(check,'check.py'),'print(1)');f.input.verify='python3 "'+join(check,'check.py')+'"';const r=f.run();writeFileSync(join(check,'helper.py'),'# changed inventory');assert.throws(()=>assertRun(r),/external_acceptance_tree_changed/);
});
test('npm test locks its package script definition',()=>{
 const f=fixture('npm test');writeFileSync(join(f.workspace,'package.json'),'{"scripts":{"test":"node check.js"}}');const r=f.run();writeFileSync(join(f.workspace,'package.json'),'{"scripts":{"test":"true"}}');assert.throws(()=>assertRun(r),/frozen_dependency_changed|frozen_input_changed/);
});
test('profile mutation and deadline cannot inherit a previous pass',()=>{
 const f=fixture(),r=f.run();r.p.acceptance.command='true # changed';assert.throws(()=>assertRun(r),/profile_changed/);
});
async function certified() {
 const f=fixture(),run=f.run();writeFileSync(join(f.workspace,'app.txt'),'implementation');writeFileSync(join(f.workspace,run.p.delivery.files[0]),'真实交付和验证说明。'.repeat(20));
 const goal={id:'goal-test',revision:1,objective:run.p.goal.objective,maxGoalRounds:8,phase:'active'};
 const events=[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:run.rootMessage}]}},{type:'goal/change',data:{goal}}];
 const session={id:run.sessionId,header:{cwd:f.workspace},snapshotEvents:()=>events,ownEvents:()=>events};
 const projection={enabled:true,integrity:'valid',hostStatus:'supported',epoch:1,sessionRefDigest:'session-identity',hostLockDigest:'audited-host'};
 Object.defineProperty(projection,'currentGoalRef',{get:()=>({id:goal.id,revision:goal.revision})});
 const native=new ConfiguredTask({session},{sync(){},projection},async()=>true,run.p);gate.registerGuard(session,()=>native.view());
 const first=await native.phase({stage:1,action:'verify'});assert.equal(first.status,'verified');
 appendFileSync(join(f.workspace,run.p.journal),'真实验收通过 '+first.verification_id+'；剩余：签证和完成。');
 assert.equal((await native.phase({stage:1,action:'record',verification_id:first.verification_id})).status,'recorded');
 const checkpoint=gate.wrapCheckpoint(session,{execute:()=>native.checkpoint()});
 assert.equal((await checkpoint.execute()).status,'certified');
 return {f,run,session,goal,native,checkpoint};
}
test('passing acceptance without a certificate cannot complete',async()=>{
 const f=fixture(),r=f.run(),s={id:r.sessionId,header:{cwd:f.workspace}};gate.registerGuard(s,()=>({enabled:true,integrity:'valid',hostStatus:'supported'}));
 const x=await gate.verify(s,r.p.acceptance.command,async()=>({ok:true,detail:'real process passed'}));assert(!x.ok);assert.match(x.detail,/certificate_missing/);
});
test('same candidate needs a fresh certificate after the real Goal revision changes',async()=>{
 const x=await certified(),first=x.native.authority.read();assert(gate.check(x.session).ok);
 x.goal.phase='complete';x.goal.revision=2;assert(!gate.check(x.session).ok);
 assert.equal((await x.checkpoint.execute()).status,'certified');const second=x.native.authority.read();assert.notEqual(first.digest,second.digest);assert.equal(first.identity.candidate,second.identity.candidate);
 const verdict=await gate.verify(x.session,x.run.p.acceptance.command,async()=>({ok:true,detail:'pass'}));assert(verdict.ok);
});
test('candidate edits invalidate a valid certificate even when acceptance passes again',async()=>{
 const x=await certified();appendFileSync(join(x.f.workspace,'app.txt'),'changed');assert(!gate.check(x.session).ok);
 const verdict=await gate.verify(x.session,x.run.p.acceptance.command,async()=>({ok:true,detail:'pass'}));assert(!verdict.ok);
});
test('an expired or stopped run cannot re-use its profile or certificate',async()=>{
 const x=await certified();x.run.status='deadline';assert(!gate.check(x.session).ok);assert.throws(()=>assertRun(x.run),/run_terminal/);
});
test('process restart loads only a terminal tombstone and never restores completion authority',()=>{
 const f=fixture(),r=createRun(f.input,join(f.dir,'restart'));loadTombstones(join(f.dir,'restart'));
 const tombstone=runFor(r.sessionId);assert.equal(tombstone.status,'interrupted');assert(tombstone.persisted);
 assert.equal(profileFor(f.workspace,r.sessionId),undefined);assert.throws(()=>assertRun(tombstone),/run_terminal/);
 assert(gate.required({id:r.sessionId,header:{cwd:f.workspace}}));
});
