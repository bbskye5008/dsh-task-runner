import {readFileSync,lstatSync,realpathSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute,relative,extname} from 'node:path';
import {parse} from 'shell-quote';
import {spawnSync} from 'node:child_process';
import {hash,regular,treeInventory} from './profile-store.mjs';

export function parseInput(raw) {
  const s=raw.trim();let value;
  if(s.startsWith('{'))value=JSON.parse(s);
  else {
    const args=parse(s,{});value={};const names={'--workspace':'workspace','--task':'task','--task-file':'taskFile','--verify':'verify','--rounds':'rounds','--minutes':'minutes','--freeze':'freeze'};
    for(let i=0;i<args.length;i++){const key=names[args[i]],v=args[++i];if(!key||typeof v!=='string')throw Error('Use --workspace PATH --task TEXT --verify COMMAND');if(key==='freeze')(value.freeze??=[]).push(v);else if(value[key]!==undefined)throw Error('duplicate_option:'+key);else value[key]=v;}
  }
  if(!value||Array.isArray(value)||typeof value!=='object')throw Error('input_object_required');
  const allowed=new Set(['workspace','task','taskFile','verify','rounds','minutes','freeze']);
  for(const k of Object.keys(value))if(!allowed.has(k))throw Error('unknown_option:'+k);
  if(value.taskFile){if(value.task)throw Error('task_and_task_file_conflict');value.task=regular(resolve(value.taskFile)).toString('utf8');}
  if(typeof value.workspace!=='string'||!isAbsolute(value.workspace))throw Error('absolute_workspace_required');
  value.workspace=realpathSync(value.workspace);if(!lstatSync(value.workspace).isDirectory())throw Error('workspace_directory_required');
  if(typeof value.task!=='string'||!value.task.trim()||value.task.length>60000)throw Error('task_required_max_60000_characters');
  if(typeof value.verify!=='string'||!value.verify.trim()||value.verify.length>8192||value.verify.includes('\0'))throw Error('verification_command_required');
  const syntax=spawnSync('/bin/sh',['-n','-c',value.verify],{timeout:1000,encoding:'utf8'});if(syntax.status!==0)throw Error('invalid_verification_shell_syntax:'+syntax.stderr);
  value.rounds=Number(value.rounds??8);value.minutes=Number(value.minutes??90);
  if(!Number.isInteger(value.rounds)||value.rounds<1||value.rounds>8)throw Error('rounds_must_be_1_to_8');
  if(!Number.isFinite(value.minutes)||value.minutes<=0||value.minutes>90)throw Error('minutes_must_be_at_most_90');
  if(value.freeze&&!Array.isArray(value.freeze))throw Error('freeze_array_required');
  return value;
}
export function discoverFrozen(input) {
  const cwd=input.workspace,files={},roots=[],externalTrees={};let count=0,bytes=0;
  const add=path=>{
    path=realpathSync(path);const st=lstatSync(path);
    if(st.isDirectory()){if(path===cwd||path===dirname(cwd)||path==='/')throw Error('acceptance_root_too_broad');for(const n of readdirSync(path).sort())add(join(path,n));}
    else if(st.isFile()){if(++count>3000||(bytes+=st.size)>32*1024*1024)throw Error('acceptance_inputs_too_large_use_a_dedicated_checker_directory');files[path]=hash(regular(path));}
    else throw Error('acceptance_regular_files_required');
  };
  const lock=path=>{
    path=resolve(cwd,path);if(!existsSync(path))throw Error('frozen_path_missing:'+path);
    const st=lstatSync(path);if(st.isSymbolicLink())throw Error('acceptance_symlink_not_supported:'+path);
    if(st.isDirectory()){
      if(path===cwd)throw Error('cannot_freeze_entire_implementation_workspace');
      if(path.startsWith(cwd+'/'))roots.push(relative(cwd,path));else externalTrees[path]=inventory(path);
    }add(path);
  };
  for(const n of ['AGENTS.md','TASK.txt','TASK.md'])if(existsSync(join(cwd,n)))lock(n);
  for(const n of ['tests','test','__tests__','checks','evaluator'])if(existsSync(join(cwd,n))&&lstatSync(join(cwd,n)).isDirectory())lock(n);
  for(const token of parse(input.verify,name=>'$'+name)){
    if(typeof token!=='string'||!['.py','.js','.mjs','.cjs','.sh','.ts'].includes(extname(token)))continue;
    const path=resolve(cwd,token);if(!existsSync(path))continue;
    lock(path.startsWith(cwd+'/')?path:dirname(path));
  }
  if(/(?:^|[;&|\s])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?/.test(input.verify))for(const n of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock'])if(existsSync(join(cwd,n)))lock(n);
  for(const n of ['pytest.ini','pyproject.toml','setup.cfg','tox.ini','jest.config.js','jest.config.mjs','vitest.config.ts'])if(existsSync(join(cwd,n)))lock(n);
  for(const path of input.freeze??[])lock(path);
  return {files,lockedFiles:Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith(cwd+'/')).map(([p,h])=>[relative(cwd,p),h])),lockedTrees:[...new Set(roots)],externalTrees};
}
export function inventory(root) {return treeInventory(dirname(root),[root]);}
