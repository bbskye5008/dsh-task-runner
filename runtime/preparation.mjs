import {mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,readlinkSync,existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parse} from 'shell-quote';
import {hash,regular,within,treeInventory} from './profile-store.mjs';
import {parseInput} from './input.mjs';

const OMIT=new Set(['.git','node_modules','__pycache__','.scratch','.pytest_cache','.mypy_cache','.ruff_cache']);
const PREP_ID=/^prep-[a-f0-9-]{36}$/;
export function sourceDigest(workspace,artifactRoot){
  const rows=[];
  const visit=dir=>{for(const n of readdirSync(dir).sort()){
    if(OMIT.has(n))continue;
    const p=join(dir,n);if(p===artifactRoot)continue;
    const st=lstatSync(p),key=relative(workspace,p);
    if(st.isSymbolicLink())rows.push([key,'symlink',readlinkSync(p)]);
    else if(st.isDirectory())visit(p);
    else if(st.isFile())rows.push([key,hash(readFileSync(p))]);
    else throw Error('preparation_unsupported_source:'+key);
  }};visit(workspace);return hash(JSON.stringify(rows));
}
export function createPreparation(input,home){
  const id='prep-'+randomUUID(),dir=join(home,'preparations',id),artifactRoot=join(input.workspace,'.spec-workflow',id);
  // A symlinked artifact parent must never turn the restricted writer into an escape.
  for(const p of [join(input.workspace,'.spec-workflow'),artifactRoot])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('preparation_symlink');
  mkdirSync(artifactRoot,{recursive:true});mkdirSync(dir,{recursive:true,mode:0o700});
  const p={schema:'dsh-task-preparation-state/v1',id,dir,artifactRoot,input,status:'clarifying',createdAt:Date.now(),sessionId:'session-'+randomUUID()};
  p.sourceDigest=sourceDigest(input.workspace,artifactRoot);savePreparation(p);return p;
}
export function savePreparation(p){writeFileSync(join(p.dir,'state.json'),JSON.stringify(p,null,2)+'\n',{mode:0o600});}
export function readPreparation(home,id){
  if(!PREP_ID.test(id))throw Error('invalid_preparation_id');
  const dir=join(home,'preparations',id),p=JSON.parse(regular(join(dir,'state.json')));
  if(p.id!==id||p.dir!==dir||p.artifactRoot!==join(p.input.workspace,'.spec-workflow',id))throw Error('preparation_state_mismatch');return p;
}
export function writePreparation(p,path,content){
  if(!['clarifying','specifying','generating','awaiting_approval'].includes(p.status))throw Error('preparation_not_editable');
  if(typeof path!=='string'||isAbsolute(path)||!path||typeof content!=='string'||Buffer.byteLength(content)>256000)throw Error('preparation_artifact_input');
  const target=within(p.artifactRoot,path);if(target===p.artifactRoot||path.split('/').includes('.task-runner'))throw Error('reserved_preparation_path');
  let at=p.artifactRoot;for(const n of relative(p.artifactRoot,target).split('/')){at=join(at,n);if(existsSync(at)&&lstatSync(at).isSymbolicLink())throw Error('preparation_symlink');}
  if(realpathSync(p.artifactRoot)!==p.artifactRoot)throw Error('preparation_symlink');
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
  if(p.status==='awaiting_approval'){p.status='generating';delete p.digest;delete p.review;}
  savePreparation(p);return {path:target,bytes:Buffer.byteLength(content),status:p.status};
}
export function assertPreparationSource(p){if(sourceDigest(p.input.workspace,p.artifactRoot)!==p.sourceDigest)throw Error('preparation_source_changed_requires_new_preparation');}
function document(p,name){const path=within(p.artifactRoot,name);if(!name||path===p.artifactRoot)throw Error('preparation_document_path');const content=regular(path).toString('utf8');if(content.trim().length<40)throw Error('preparation_document_too_short:'+name);return {path,content};}
function manifest(p){
  const m=JSON.parse(regular(join(p.artifactRoot,'acceptance.json')));
  if(m.schema!=='dsh-task-preparation/v1'||!Array.isArray(m.openQuestions)||m.openQuestions.length)throw Error('preparation_unresolved_questions');
  document(p,m.requirements);document(p,m.spec);
  if(!Array.isArray(m.criteria)||!m.criteria.length||m.criteria.length>40)throw Error('preparation_criteria_required');
  const seen=new Set();for(const c of m.criteria){
    if(!/^[A-Z][A-Z0-9_-]{1,39}$/.test(c.id)||seen.has(c.id)||typeof c.description!=='string'||c.description.trim().length<8)throw Error('preparation_criterion');seen.add(c.id);
    if(typeof c.command!=='string'||!c.command.trim()||c.command.length>4096||c.command.includes('\0')||c.command.includes(p.input.workspace))throw Error('preparation_criterion_command_must_use_snapshot_relative_paths');
    const check=spawnSync('/bin/sh',['-n','-c',c.command],{timeout:1000,encoding:'utf8'});if(check.status!==0)throw Error('preparation_criterion_shell_syntax');
    if(!Array.isArray(c.evidenceFiles)||!c.evidenceFiles.length)throw Error('preparation_criterion_evidence');
    for(const file of c.evidenceFiles){const d=within(p.artifactRoot,file);if(file.startsWith('.task-runner/'))throw Error('preparation_reserved_evidence');regular(d);}
  }return m;
}
const dispatcher=criteria=>`# Generated by Task Runner. All reviewed checks must pass.\nimport base64, json, subprocess, sys, time\nchecks = json.loads(base64.b64decode(${JSON.stringify(Buffer.from(JSON.stringify(criteria),'utf8').toString('base64'))}))\nfailed = []\nstart = time.monotonic()\nfor c in checks:\n    try:\n        p = subprocess.run(c['command'], shell=True, executable='/bin/sh', timeout=max(1, 110-(time.monotonic()-start)))\n        ok = p.returncode == 0\n    except Exception as e:\n        print(str(e), file=sys.stderr)\n        ok = False\n    print(json.dumps({'id': c['id'], 'ok': ok}, ensure_ascii=False), flush=True)\n    if not ok: failed.append(c['id'])\nprint(json.dumps({'passed': len(checks)-len(failed), 'total': len(checks), 'failed': failed}, ensure_ascii=False))\nsys.exit(1 if failed else 0)\n`;
function artifacts(p){return treeInventory(p.input.workspace,[relative(p.input.workspace,p.artifactRoot)]);}
function binding(p){return hash(JSON.stringify({request:p.input,sourceDigest:p.sourceDigest,artifacts:artifacts(p)}));}
export function publishPreparation(p,loadedSkills=[]){
  if(!['clarifying','specifying','generating','awaiting_approval'].includes(p.status))throw Error('preparation_not_editable');
  if(!['to-grill','to-spec'].every(n=>loadedSkills.includes(n)))throw Error('preparation_both_specworkflow_stages_required');
  assertPreparationSource(p);const m=manifest(p);
  const target=join(p.artifactRoot,'.task-runner');mkdirSync(target,{recursive:true});
  if(lstatSync(target).isSymbolicLink())throw Error('preparation_symlink');
  writeFileSync(join(target,'check.py'),dispatcher(m.criteria));
  const rel=relative(p.input.workspace,join(target,'check.py'));
  const verify="python3 '"+rel.replaceAll("'","'\\''")+"'";
  p.digest=binding(p);p.status='awaiting_approval';p.verify=verify;p.loadedSkills=[...loadedSkills];p.criteria=m.criteria;
  const requirements=document(p,m.requirements).content,spec=document(p,m.spec).content;
  p.review=join(p.dir,'review.md');
  const rows=['# 待确认：需求、规格与验收脚本','',p.input.task,'','## 需求',requirements,'','## 规格',spec,'','## 验收条件',...m.criteria.map(c=>`- ${c.id}：${c.description}\n  命令：\`${c.command}\`\n  脚本：${c.evidenceFiles.join(', ')}`),'','## 文件摘要',...Object.entries(artifacts(p)).map(([path,digest])=>`- ${path}: ${digest}`),'',`确认摘要：${p.digest}`,`正式执行上限：${p.input.rounds} 轮 / ${p.input.minutes} 分钟；当前尚未启动执行。`,'',`在 Harness 输入：/task-run approve ${p.id} ${p.digest}`,`或终端：dsh-task approve ${p.id} ${p.digest}`];
  writeFileSync(p.review,rows.join('\n')+'\n');savePreparation(p);
  return {status:p.status,id:p.id,digest:p.digest,review:p.review,criteria:p.criteria,verify,approvalCommand:`/task-run approve ${p.id} ${p.digest}`};
}
export function approvedInput(p,digest){
  if(p.status!=='awaiting_approval')throw Error('preparation_not_awaiting_approval');
  if(digest!==p.digest||binding(p)!==p.digest)throw Error('preparation_approval_stale');
  assertPreparationSource(p);const m=manifest(p);
  const task=[p.input.task,'\n已确认需求：',document(p,m.requirements).content,'\n已确认规格：',document(p,m.spec).content,'\n验收条件：',...m.criteria.map(c=>c.id+' '+c.description),'\n准备阶段摘要：'+p.digest].join('\n');
  const {taskFile,...base}=p.input;
  const input=parseInput(JSON.stringify({...base,task,verify:p.verify,freeze:[...p.input.freeze??[],p.artifactRoot]}));
  // Operator-owned handoff metadata cannot be supplied through the public parser.
  input.preparation={id:p.id,digest:p.digest,criteria:m.criteria.map(({id,description})=>({id,description}))};
  return input;
}
export function preparationToolDenial(p,name,args={}){
  if(!['clarifying','specifying','generating','awaiting_approval'].includes(p.status))return 'Preparation is no longer active.';
  if(['task_prepare_write','task_prepare_generate','task_prepare_submit','todo_write','update_plan','run_code'].includes(name))return;
  if(name==='skill')return ['to-grill','to-spec'].includes(args.name)?undefined:'Only SpecWorkflow to-grill and to-spec are part of this preparation.';
  if(['read','read_file','list_directory','search_files','glob','grep','file_search','text_search'].includes(name))return;
  if(name==='bash'){
    const command=args.command??args.cmd??'';
    // Only discovery reads; all artifact writes use the bounded writer tool.
    const tokens=parse(command,{});if(tokens.some(x=>typeof x!=='string'||/[\n\r`]/.test(x)))return 'Preparation bash supports a single read-only command.';
    const [cmd,...a]=tokens;
    if(['pwd','ls','cat','head','tail'].includes(cmd)&&!a.some(x=>x.startsWith('/dev/')))return;
    if(cmd==='rg'&&!a.some(x=>/^--(pre|hostname-bin)(=|$)/.test(x)))return;
    if(cmd==='git'&&['status','rev-parse','diff','log'].includes(a[0])&&!a.some(x=>/ext-diff|textconv|output|^-c$/.test(x)))return;
  }
  return 'Preparation permits discovery, the first two SpecWorkflow skills, and artifact writing only; implementation and execution approval are separate.';
}
export function preparationPrompt(p){return `这是 task-run 的准备会话，当前只做需求澄清、规格与验收准备，尚未启动 PUA/Goal。全程中文。\n原始请求：\n${p.input.task}\n\n工作区：${p.input.workspace}\n本次专用文档目录：${p.artifactRoot}\n步骤：\n1. 调用 skill(name="to-grill")，先阅读项目，自行查明事实；只对必要业务决策逐个提问并等待用户回答。用 task_prepare_write 写 requirements.md。\n2. 问题关闭后调用 skill(name="to-spec")，整理 spec.md，包括范围、非目标、边界和每条验收条件。前两个技能阶段不写代码。\n3. 退出 to-spec 的无代码阶段，进入本适配器的验收准备：用 task_prepare_write 在上述专用目录的 acceptance/ 下生成独立、无需联网的验收脚本和固定数据；不能写或修复生产代码，不能改现有测试。验收必须针对实际待交付功能，覆盖正常、异常、边界和既有行为，不能只检查文件存在或打印 pass。\n4. 用 task_prepare_write 写 acceptance.json，格式 ${JSON.stringify({schema:'dsh-task-preparation/v1',requirements:'requirements.md',spec:'spec.md',openQuestions:[],criteria:[{id:'AC01',description:'具体可观察的验收条件',command:"python3 '"+relative(p.input.workspace,p.artifactRoot)+"/acceptance/check.py' AC01",evidenceFiles:['acceptance/check.py']}]})}。每条条件都要映射到实际命令和脚本；命令相对于工作区运行，不能写死原工作区绝对路径。\n5. task_prepare_submit 生成待确认摘要和 review.md；向用户列出具体验收条件、规格与脚本位置及返回的 approve 命令，然后等待。只有用户的 approve 命令可以启动正式执行，不要自行执行 CLI、创建 Goal、启动 PUA、调用 spec-do 或任何其他执行后端。现有 Task Runner 是唯一执行后端，执行上限 ${p.input.rounds} 轮、${p.input.minutes} 分钟。SpecWorkflow 的执行模式选择由最后这个有摘要的确认替代。修改草稿后必须重新 submit；确认不沿用到新版本。\n准备阶段 bash 仅允许单条 pwd/ls/cat/head/tail/rg/git status/diff/log/rev-parse 查询；不能运行 Python/Node 或用重定向写文件。所有草稿写入 task_prepare_write(path=相对专用目录路径,content=文本)。可读取已加载技能的 references。\n`;}
