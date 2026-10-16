import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bundledPayloadFiles,taskRunnerGuardOwner} from '../runtime/bundled-owner.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
async function fixture(t) {
  const profile=mkdtempSync(join(tmpdir(),'task-runner-only-')),root=join(profile,'node_modules/dsh-task-runner');
  t.after(()=>rmSync(profile,{recursive:true,force:true}));
  const paths=[...bundledPayloadFiles(repo),'vendor/bundle-integrity.json','package.json'];
  for(const p of paths){mkdirSync(dirname(join(root,p)),{recursive:true});cpSync(join(repo,p),join(root,p));}
  mkdirSync(join(root,'node_modules'),{recursive:true});
  symlinkSync(dirname(require.resolve('js-yaml/package.json')),join(root,'node_modules/js-yaml'));
  const manifest={name:'dsh-profile-desktop',dependencies:{'dsh-task-runner':'file:runner.tgz'},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-task-runner']}}};
  const lock={lockfileVersion:'9.0',importers:{'.':{dependencies:{'dsh-task-runner':{specifier:'file:runner.tgz',version:'file:runner.tgz'}}}},packages:{'dsh-task-runner@file:runner.tgz':{resolution:{integrity:'sha512-fixture'}}},snapshots:{'dsh-task-runner@file:runner.tgz':{}}};
  const save=()=>{writeFileSync(join(profile,'package.json'),JSON.stringify(manifest));writeFileSync(join(profile,'pnpm-lock.yaml'),JSON.stringify(lock));};save();
  const api=await import(pathToFileURL(join(root,'runtime/bundled-owner.mjs')));
  return {profile,root,manifest,lock,save,check:()=>api.taskRunnerGuardOwner(profile,'0.9.0')};
}
test('Task Runner alone owns its bundled Guard without standalone installation records',async t=>{
  const f=await fixture(t);assert.equal(f.check(),join(f.root,'package.json'));
  assert.deepEqual(Object.keys(f.manifest.dependencies),['dsh-task-runner']);
});
test('unselected composite does not grant an installation identity',async t=>{
  const f=await fixture(t);f.manifest.dsh.profile.bundles.pop();f.save();assert.equal(f.check(),undefined);
});
for(const [label,change,error] of [
  ['missing dependency',f=>delete f.manifest.dependencies['dsh-task-runner'],/importer_missing/],
  ['missing importer',f=>delete f.lock.importers['.'].dependencies['dsh-task-runner'],/importer_missing/],
  ['different source',f=>f.manifest.dependencies['dsh-task-runner']='file:other.tgz',/importer_missing/],
  ['missing resolution',f=>delete f.lock.packages['dsh-task-runner@file:runner.tgz'],/resolution_missing/],
  ['missing snapshot',f=>delete f.lock.snapshots['dsh-task-runner@file:runner.tgz'],/resolution_missing/],
  ['missing official bundle',f=>f.manifest.dsh.profile.bundles.shift(),/profile_invalid/],
  ['headless owner',f=>f.manifest.dsh.profile.bundles.push('@deepseek-ai/dsh-headless'),/profile_invalid/],
  ['different profile kind',f=>f.manifest.name='dsh-profile-web',/profile_invalid/]
])test('selected composite fails closed: '+label,async t=>{const f=await fixture(t);change(f);f.save();assert.throws(f.check,error);});
test('copied owner identity cannot authenticate another loaded runtime',async t=>{
  const f=await fixture(t);assert.throws(()=>taskRunnerGuardOwner(f.profile,'0.9.0'),/runtime_mismatch/);
});
test('changed bundled code and extra component files fail closed',async t=>{
  const f=await fixture(t);writeFileSync(join(f.root,'index.mjs'),'changed');assert.throws(f.check,/payload_changed/);
  writeFileSync(join(f.root,'vendor/extra.js'),'extra');assert.throws(f.check,/inventory_changed/);
});
test('symlinked bundled payload and changed component versions fail closed',async t=>{
  const f=await fixture(t);const p=join(f.root,'vendor/extra.js');symlinkSync(join(f.root,'index.mjs'),p);assert.throws(f.check,/linked_payload/);rmSync(p);
  const m=JSON.parse(readFileSync(join(f.root,'package.json')));m.dsh.taskRunner.components.guard='0.8.0';writeFileSync(join(f.root,'package.json'),JSON.stringify(m));assert.throws(f.check,/component_versions/);
});
test('changed component manifest is rejected even when every source file exists',async t=>{
  const f=await fixture(t);writeFileSync(join(f.root,'vendor/bundle-integrity.json'),'{}');assert.throws(f.check,/integrity_changed/);
});
