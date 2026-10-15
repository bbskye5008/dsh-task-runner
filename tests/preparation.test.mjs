import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseInput} from '../runtime/input.mjs';
import {createPreparation,writePreparation,publishPreparation,approvedInput,readPreparation,preparationToolDenial} from '../runtime/preparation.mjs';
import {createRun} from '../runtime/run-config.mjs';
import {assertRun,registerRun} from '../runtime/profile-store.mjs';
import {executeAcceptance} from '../runtime/acceptance.mjs';

const setup=()=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-需求准备-')),initialWorkspace=join(dir,'工作 区');mkdirSync(initialWorkspace);writeFileSync(join(initialWorkspace,'app.py'),'raise SystemExit(5)\n');
  const input=parseInput(JSON.stringify({workspace:initialWorkspace,task:'给现有工具增加中文分组汇总，支持错误数据拒绝、空输入和确定性结果。'}),{allowPreparation:true}),workspace=input.workspace;
  const p=createPreparation(input,join(dir,'home'));
  writePreparation(p,'requirements.md','这是已明确的真实业务需求。需要检查正常输入、异常数据以及空输入，保留既有命令行约定。'.repeat(3));
  writePreparation(p,'spec.md','规格约定：中文 JSON 输入，输出稳定排序，数据无效时返回非零退出码，不能产生部分输出。'.repeat(3));
  writePreparation(p,'acceptance/check.py',"import subprocess,sys\np=subprocess.run([sys.executable,'app.py'])\nsys.exit(p.returncode)\n");
  const m={schema:'dsh-task-preparation/v1',requirements:'requirements.md',spec:'spec.md',openQuestions:[],criteria:[{id:'AC01',description:'实际运行命令行并检查正常结果与退出码',command:"python3 '"+relative(workspace,join(p.artifactRoot,'acceptance/check.py'))+"'",evidenceFiles:['acceptance/check.py']}]};
  const save=()=>writePreparation(p,'acceptance.json',JSON.stringify(m));save();return {dir,workspace,input,p,m,save,publish:()=>publishPreparation(p,['to-grill','to-spec'])};
};
test('missing verifier enters preparation only through the explicit preparation parser',()=>{
 const f=setup();assert.equal(f.input.verify,undefined);assert.equal(f.input.rounds,8);assert.equal(f.input.minutes,90);
 assert.throws(()=>parseInput(JSON.stringify(f.input)),/verification_command_required/);
 for(const change of [{rounds:9},{minutes:91},{verify:''}])assert.throws(()=>parseInput(JSON.stringify({...f.input,...change}),{allowPreparation:true}));
});
test('preparation does not create an executable run and cannot approve before publication',()=>{
 const f=setup();assert.equal(readPreparation(join(f.dir,'home'),f.p.id).status,'clarifying');assert.throws(()=>approvedInput(f.p,'anything'),/not_awaiting_approval/);
});
test('both actual upstream stages and closed questions are required',()=>{
 const f=setup();assert.throws(()=>publishPreparation(f.p,['to-grill']),/both_specworkflow_stages/);
 f.m.openQuestions=['无效行如何处理待确认'];f.save();assert.throws(f.publish,/unresolved_questions/);
});
test('criteria must be unique and mapped to real evidence files',()=>{
 const f=setup();f.m.criteria.push({...f.m.criteria[0]});f.save();assert.throws(f.publish,/preparation_criterion/);
 f.m.criteria.pop();f.m.criteria[0].evidenceFiles=['missing.py'];f.save();assert.throws(f.publish,/ENOENT/);
});
test('production changes during interview prevent publishing and approval',()=>{
 const f=setup();f.publish();appendFileSync(join(f.workspace,'app.py'),'# changed');assert.throws(()=>approvedInput(f.p,f.p.digest),/source_changed/);assert.throws(f.publish,/source_changed/);
});
test('writer rejects traversal, reserved dispatcher path and symlink escapes',()=>{
 const f=setup();assert.throws(()=>writePreparation(f.p,'../../app.py','bad'),/outside_workspace/);
 assert.throws(()=>writePreparation(f.p,'.task-runner/check.py','bad'),/reserved/);
 symlinkSync(f.workspace,join(f.p.artifactRoot,'escape'));assert.throws(()=>writePreparation(f.p,'escape/app.py','bad'),/symlink/);
});
for(const file of ['requirements.md','spec.md','acceptance.json','acceptance/check.py','.task-runner/check.py','new-helper.py'])test('any changed or added reviewed artifact invalidates approval: '+file,()=>{
 const f=setup();f.publish();appendFileSync(join(f.p.artifactRoot,file),'\n# mutation');assert.throws(()=>approvedInput(f.p,f.p.digest),/approval_stale/);
});
test('normal draft edits invalidate published status; resubmission requires a new digest',()=>{
 const f=setup();f.publish();const old=f.p.digest;writePreparation(f.p,'spec.md','更新后的明确规格与验收约定。'.repeat(20));assert.throws(()=>approvedInput(f.p,old),/not_awaiting/);
 f.publish();assert.notEqual(f.p.digest,old);assert.throws(()=>approvedInput(f.p,old),/approval_stale/);assert.equal(approvedInput(f.p,f.p.digest).rounds,8);
});
test('task-file preparation hands off expanded approved text without conflicting original taskFile',()=>{
 const f=setup();f.p.input.taskFile=join(f.dir,'task.txt');writeFileSync(f.p.input.taskFile,f.p.input.task);f.publish();
 const input=approvedInput(f.p,f.p.digest);assert.equal(input.taskFile,undefined);assert(input.task.includes('已确认规格'));
});
test('approved handoff freezes all spec and acceptance files and keeps exact budgets',async()=>{
 const f=setup();f.publish();const input=approvedInput(f.p,f.p.digest);assert(input.task.includes('已确认规格'));assert.equal(input.rounds,8);assert.equal(input.minutes,90);
 const run=createRun(input,join(f.dir,'runs'));registerRun(run);assertRun(run);assert.equal(run.deadline-run.started,5400000);
 const result=await executeAcceptance(run);assert.equal(result.ok,false);assert.equal(result.exitCode,1);assert(result.stdout.includes('AC01'));
 appendFileSync(join(f.p.artifactRoot,'acceptance/check.py'),'# changed');assert.throws(()=>assertRun(run),/frozen_dependency|frozen_input|locked_tree/);
});
test('host dispatcher executes every reviewed criterion and rejects any failure',()=>{
 const f=setup();f.m.criteria.push({id:'AC02',description:'第二条独立验收必须真实执行并通过',command:'exit 0',evidenceFiles:['acceptance/check.py']});f.save();f.publish();
 const first=spawnSync('/bin/sh',['-c',f.p.verify],{cwd:f.workspace,encoding:'utf8'});assert.equal(first.status,1);assert(first.stdout.includes('AC02'));
 writeFileSync(join(f.workspace,'app.py'),'raise SystemExit(0)\n');const second=spawnSync('/bin/sh',['-c',f.p.verify],{cwd:f.workspace,encoding:'utf8'});assert.equal(second.status,0);assert(second.stdout.includes('"passed": 2'));
});
test('host dispatcher executes long Chinese criteria with quotes, escapes and Unicode separators',()=>{
 const f=setup();f.m.criteria[0].description='中文验收条件、引号"、反斜杠\\、换行\n与分隔符\u2028\u2029'.repeat(600);f.save();f.publish();
 writeFileSync(join(f.workspace,'app.py'),'raise SystemExit(0)\n');
 const result=spawnSync('/bin/sh',['-c',f.p.verify],{cwd:f.workspace,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('"passed": 1'));
});
test('preparation tools cannot approve themselves, implement code or start another workflow',()=>{
 const f=setup();for(const [name,args]of [['bash',{command:'dsh-task approve prep-id digest'}],['bash',{command:'python3 script.py'}],['bash',{command:'cat app.py > app2.py'}],['bash',{command:'git status; rm app.py'}],['bash',{command:'rg --pre=python3 a'}],['write_file',{}],['update_goal',{}],['skill',{name:'spec-do'}],['create_agent',{}]])assert(preparationToolDenial(f.p,name,args),name);
 assert.equal(preparationToolDenial(f.p,'bash',{command:'rg --files'}),undefined);assert.equal(preparationToolDenial(f.p,'skill',{name:'to-grill'}),undefined);
 f.p.status='executing';assert(preparationToolDenial(f.p,'task_prepare_write',{}));
});
test('every preparation stage and native todo tool is admitted through the guard while production writes stay blocked',()=>{
 const f=setup();for(const name of ['task_prepare_write','task_prepare_generate','task_prepare_submit','todo_write'])assert.equal(preparationToolDenial(f.p,name,{}),undefined,name);
 assert(preparationToolDenial(f.p,'write',{file_path:'tickets.py',content:'bad'}));
 f.p.status='cancelled';for(const name of ['task_prepare_write','task_prepare_generate','task_prepare_submit','todo_write'])assert(preparationToolDenial(f.p,name,{}),name);
});
