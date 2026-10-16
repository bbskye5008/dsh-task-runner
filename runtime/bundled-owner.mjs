import {readFileSync,realpathSync,lstatSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {installedReferenceMatches} from './installation-identity.mjs';

const NAME='dsh-task-runner';
const COMPONENTS={guard:'0.9.0',pua:'0.3.27',specworkflow:'0.1.1'};
const SELF=fileURLToPath(new URL('../',import.meta.url));
const hash=x=>createHash('sha256').update(x).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const fail=reason=>{throw Error('bundled_owner_'+reason);};
export function bundledPayloadFiles(root) {
  const out=[];
  function visit(dir) {
    for(const name of readdirSync(dir).sort()) {
      const path=join(dir,name),stat=lstatSync(path),rel=relative(root,path).split(sep).join('/');
      if(rel==='vendor/bundle-integrity.json')continue;
      if(stat.isSymbolicLink())fail('linked_payload');
      if(stat.isDirectory())visit(path);
      else if(stat.isFile())out.push(rel);
      else fail('unsupported_payload');
    }
  }
  for(const name of ['runtime','vendor'])visit(join(root,name));
  for(const name of ['index.mjs','guard.mjs','specworkflow.mjs','cli.mjs','cordis.patch.yml'])out.push(name);
  return out.sort();
}
export function verifyBundledPayload(root,manifest=json(join(root,'package.json'))) {
  const meta=manifest.dsh?.taskRunner;
  if(meta?.schema!=='dsh-task-runner-bundle/v1'||Object.entries(COMPONENTS).some(([k,v])=>meta.components?.[k]!==v))fail('component_versions');
  if(!/^[a-f0-9]{64}$/.test(meta.integrity??''))fail('integrity_missing');
  const bytes=readFileSync(join(root,'vendor/bundle-integrity.json'));
  if(hash(bytes)!==meta.integrity)fail('integrity_changed');
  const inventory=JSON.parse(bytes);
  if(inventory.schema!=='dsh-task-runner-payload/v1'||!inventory.files||Array.isArray(inventory.files))fail('inventory_invalid');
  const paths=bundledPayloadFiles(root);
  if(JSON.stringify(Object.keys(inventory.files).sort())!==JSON.stringify(paths))fail('inventory_changed');
  for(const path of paths)if(hash(readFileSync(join(root,path)))!==inventory.files[path])fail('payload_changed:'+path);
  return {components:{...COMPONENTS},integrity:meta.integrity,files:paths.length};
}

// Only the selected, physically installed package that loaded this module can
// own this Guard. This adds a composite owner; Host SDK audits still run next.
export function taskRunnerGuardOwner(profileRoot,expectedGuardVersion) {
  const profile=json(join(profileRoot,'package.json'));
  const bundles=profile.dsh?.profile?.bundles;
  if(!Array.isArray(bundles)||!bundles.includes(NAME))return undefined;
  if(profile.name!=='dsh-profile-desktop'||!bundles.includes('@deepseek-ai/dsh-base')||!bundles.includes('@deepseek-ai/dsh-web-app')||bundles.includes('@deepseek-ai/dsh-headless'))fail('profile_invalid');
  if(expectedGuardVersion!==COMPONENTS.guard)fail('guard_version');
  const root=join(profileRoot,'node_modules',NAME),physical=realpathSync(root);
  if(physical!==realpathSync(SELF)||!physical.startsWith(realpathSync(profileRoot)+sep))fail('runtime_mismatch');
  const manifestPath=join(root,'package.json'),manifest=json(manifestPath);
  if(manifest.name!==NAME||manifest.dsh?.bundle?.patch!=='./cordis.patch.yml')fail('manifest_invalid');
  const lockText=readFileSync(join(profileRoot,'pnpm-lock.yaml'),'utf8');
  if(Buffer.byteLength(lockText)>4*1024*1024)fail('lock_too_large');
  const lock=yaml.load(lockText,{schema:yaml.JSON_SCHEMA});
  const importer=lock?.importers?.['.']?.dependencies?.[NAME];
  if(String(lock?.lockfileVersion)!=='9.0'||typeof importer?.specifier!=='string'||importer.specifier!==profile.dependencies?.[NAME]||typeof importer.version!=='string')fail('importer_missing');
  if(!installedReferenceMatches(NAME,importer.version,manifest,{lockText,profileManifest:profile}))fail('install_identity');
  const base=importer.version.split('(',1)[0];
  if(!lock.packages?.[NAME+'@'+base]||!lock.snapshots?.[NAME+'@'+importer.version])fail('resolution_missing');
  verifyBundledPayload(root,manifest);
  return manifestPath;
}
