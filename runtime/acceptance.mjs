import {spawn} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,lstat,symlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertRun,runFor} from './profile-store.mjs';

export const OMIT=new Set(['.git','node_modules','__pycache__','.scratch','.pytest_cache','.mypy_cache','.ruff_cache']);
export async function executeAcceptance(run,label='acceptance',signal=run.requestSignal) {
  assertRun(run);
  const combined=signal?AbortSignal.any([run.abort.signal,signal]):run.abort.signal;
  combined.throwIfAborted();
  const started=Date.now(),dir=join(run.dir,'checks',label+'-'+randomUUID()),snapshot=join(dir,'candidate');
  await mkdir(dir,{recursive:true});
  await cp(run.p.cwd,snapshot,{recursive:true,dereference:false,verbatimSymlinks:true,filter:src=>!relative(run.p.cwd,src).split('/').some(p=>OMIT.has(p))});
  assertRun(run);
  combined.throwIfAborted();
  try{if((await lstat(join(run.p.cwd,'node_modules'))).isDirectory())await symlink(join(run.p.cwd,'node_modules'),join(snapshot,'node_modules'),'dir');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(join(snapshot,'.scratch'),{recursive:true});
  const timeoutMs=Math.max(1,Math.min(run.checkTimeoutMs,run.deadline-Date.now()));
  const result=await new Promise((done,reject)=>{
    const child=spawn('/bin/sh',['-c',run.verify],{cwd:snapshot,detached:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:join(snapshot,'.scratch'),DSH_TASK_WORKSPACE:snapshot},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,closed=false;
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const abort=()=>kill();
    combined.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
    child.stdout.on('data',d=>{stdout=(stdout+d).slice(-150000);});
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-50000);});
    const cleanup=()=>{closed=true;clearTimeout(timer);combined.removeEventListener('abort',abort);};
    child.once('error',e=>{cleanup();reject(e);});
    child.once('close',(exitCode,signal)=>{cleanup();done({ok:exitCode===0&&!signal&&!timedOut&&!combined.aborted,exitCode,signal,timedOut,stdout,stderr});});
    if(combined.aborted&&!closed)kill();
  });
  const report={...result,label,snapshot,elapsedMs:Date.now()-started};
  await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2)+'\n');
  run.log('acceptance_process',{...report,stdout:result.stdout.slice(-5000),stderr:result.stderr.slice(-3000)});
  return report;
}
export async function runPuaAcceptance(session,signal) {
  const result=await executeAcceptance(runFor(session),'pua',signal);
  return {ok:result.ok,detail:JSON.stringify(result)};
}
