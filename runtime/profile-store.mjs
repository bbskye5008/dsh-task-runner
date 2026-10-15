import {readFileSync,lstatSync,realpathSync,readdirSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const hash = x => createHash('sha256').update(x).digest('hex');
export function regular(path) {
  const st=lstatSync(path); if(!st.isFile()||st.isSymbolicLink()) throw Error('regular_file_required:'+path);
  return readFileSync(path);
}
export function within(root,path) { const p=resolve(root,path); if(p!==root&&!p.startsWith(root+'/')) throw Error('path_outside_workspace'); return p; }
export function treeInventory(cwd,roots=[]) {
  const entries={};
  const walk=path=>{const st=lstatSync(path);const name=path.slice(cwd.length+1);if(st.isSymbolicLink())throw Error('locked_tree_symlink');
    if(st.isDirectory()){entries[name]='directory';for(const child of readdirSync(path).sort())walk(resolve(path,child));}
    else if(st.isFile())entries[name]='file:'+hash(readFileSync(path));else throw Error('locked_tree_entry');};
  for(const root of [...roots].sort())walk(within(cwd,root));return entries;
}
export function validateProfile(p) {
  if(p.schema!=='dsh-task-gate-profile/v1'||!isAbsolute(p.cwd)||!p.id||!p.goal?.objective||!Number.isInteger(p.goal.maxRounds)||p.goal.maxRounds<1) throw Error('profile_header');
  if(!Array.isArray(p.phases)||!p.phases.length||!Array.isArray(p.implementation)||!p.implementation.length) throw Error('profile_phases');
  if(!p.sources?.length||!p.lockedFiles||!p.userMessage||!p.journal||!p.delivery?.files?.length) throw Error('profile_sources');
  const ids=new Set();
  for(const c of [p.acceptance,...p.phases.map(x=>x.check)]) {
    if(!c||!isAbsolute(c.executable)||!Array.isArray(c.args)||!c.requiredChecks?.length||!Number.isInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>120000) throw Error('profile_check');
    for(const x of c.requiredChecks) if(typeof x!=='string') throw Error('check_id');
  }
  for(const ph of p.phases) { if(!ph.id||ids.has(ph.id)) throw Error('duplicate_phase'); ids.add(ph.id); }
  for(const name of [...p.implementation,...(p.implementationExcludes??[]),...(p.lockedTrees??[]),p.journal,...p.delivery.files,...Object.keys(p.lockedFiles)]) within(p.cwd,name);
  if(p.lockedTrees?.length&&JSON.stringify(treeInventory(p.cwd,p.lockedTrees))!==JSON.stringify(p.lockedTreeInventory))throw Error('locked_tree_inventory');
  // Explicit source coverage is reviewed data, not guessed Chinese semantics.
  for(const s of p.sources) {
    if(!s.name||!isAbsolute(s.path)||!s.sha256||!Array.isArray(s.bindings)) throw Error('source_schema');
    const content=regular(s.path).toString('utf8'); if(hash(content)!==s.sha256) throw Error('source_digest');
    let offset=0;
    for(const b of s.bindings) {
      if(b.start!==offset||!Number.isInteger(b.end)||b.end<=offset||b.end>content.length||!b.checks?.length) throw Error('source_coverage');
      for(const id of b.checks) if(id!=='engine-policy'&&!p.acceptance.requiredChecks.includes(id)) throw Error('unknown_source_check');
      offset=b.end;
    }
    if(offset!==content.length) throw Error('source_coverage_gap');
  }
  return p;
}
const runs = new Map();
export function registerRun(run) { if(runs.has(run.sessionId))throw Error('duplicate_run'); validateProfile(run.p); runs.set(run.sessionId,run); }
export function runFor(value) { return runs.get(typeof value==='string'?value:String(value?.id??value?.sessionId??'')); }
export function runForProfile(p) { return [...runs.values()].find(r=>r.p===p); }
export function assertRun(run) {
 if(!run)throw Error('run_missing');
 if(run.status!=='active')throw Error('run_terminal:'+run.status);
 if(Date.now()>=run.deadline)throw Error('deadline_expired');
 if(hash(JSON.stringify(run.p))!==run.profileHash)throw Error('profile_changed');
 for(const [path,digest]of Object.entries(run.frozenFiles))if(hash(regular(path))!==digest)throw Error('frozen_dependency_changed:'+path);
 for(const [path,digest]of Object.entries(run.p.lockedFiles))if(hash(regular(within(run.p.cwd,path)))!==digest)throw Error('frozen_input_changed:'+path);
 if(JSON.stringify(treeInventory(run.p.cwd,run.p.lockedTrees))!==JSON.stringify(run.p.lockedTreeInventory))throw Error('locked_tree_inventory');
 for(const [root,expected]of Object.entries(run.externalTrees??{}))if(JSON.stringify(treeInventory(dirname(root),[root]))!==JSON.stringify(expected))throw Error('external_acceptance_tree_changed');
}
export function registry() { return {assertIntegrity:p=>assertRun(runForProfile(p))}; }
export function profileFor(cwd,sessionId) { const run=runs.get(String(sessionId));return run&&!run.persisted&&resolve(run.p.cwd)===resolve(cwd||'/__missing__')?run.p:undefined; }
export function loadTombstones(home) {
 if(!existsSync(home))return;
 for(const entry of readdirSync(home,{withFileTypes:true})){
  if(!entry.isDirectory()||!/^task-[a-f0-9-]{36}$/.test(entry.name))continue;
  try{
   const dir=resolve(home,entry.name),s=JSON.parse(regular(resolve(dir,'status.json')));
   if(!/^session-[a-f0-9-]{36}$/.test(s.sessionId)||runs.has(s.sessionId))continue;
   let p;try{p=JSON.parse(regular(resolve(dir,'profile.json')));}catch{p={cwd:s.workspace,acceptance:{command:'invalid_persisted_profile'}};}
   runs.set(s.sessionId,{id:s.id,sessionId:s.sessionId,p,dir,deadline:s.deadline,status:s.status==='active'?'interrupted':s.status,persisted:true,log(){}});
  }catch{}
 }
}
loadTombstones(process.env.DSH_TASK_RUNNER_HOME||resolve(process.env.DSH_HOME||resolve(homedir(),'.dsh'),'task-runner'));
