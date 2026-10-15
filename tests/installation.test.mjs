import test from 'node:test';
import assert from 'node:assert/strict';
import {installedReferenceMatches as match} from '../runtime/installation-identity.mjs';
const name='fixture-plugin',base='https://codeload.github.com/example/plugin/tar.gz/'+'a'.repeat(40),ref=base+'(@deepseek-ai/schemastery@3.18.4)';
function fixture(){return {manifest:{name,version:'1.2.3'},profileManifest:{dependencies:{[name]:'github:example/plugin#v1.2.3'}},lock:{lockfileVersion:'9.0',importers:{'.':{dependencies:{[name]:{specifier:'github:example/plugin#v1.2.3',version:ref}}}},packages:{[name+'@'+base]:{version:'1.2.3',resolution:{tarball:base,gitHosted:true,integrity:'sha512-'+Buffer.alloc(64,1).toString('base64')}}},snapshots:{[name+'@'+ref]:{}}}};}
function check(f,reference=ref,critical=false){return match(name,reference,f.manifest,{profileManifest:f.profileManifest,lockText:JSON.stringify(f.lock),critical});}
test('pinned GitHub importer matches manifest, lock, resolution, and snapshot',()=>assert.equal(check(fixture()),true));
for(const [label,change]of [
 ['manifest version',f=>f.manifest.version='9.9.9'],
 ['manifest name',f=>f.manifest.name='other'],
 ['importer commit',f=>f.lock.importers['.'].dependencies[name].version=ref.replace('a'.repeat(40),'b'.repeat(40))],
 ['profile declaration',f=>f.profileManifest.dependencies[name]='github:example/other#v1.2.3'],
 ['resolution URL',f=>f.lock.packages[name+'@'+base].resolution.tarball=base+'other'],
 ['missing integrity',f=>delete f.lock.packages[name+'@'+base].resolution.integrity],
 ['missing snapshot',f=>delete f.lock.snapshots[name+'@'+ref]]
])test('pinned GitHub identity rejects '+label,()=>{const f=fixture();change(f);assert.equal(check(f),false);});
test('floating GitHub URL and critical Host peer substitution fail closed',()=>{assert.equal(check(fixture(),ref.replace('a'.repeat(40),'main')),false);assert.equal(check(fixture(),ref,true),false);});
test('registry versions retain exact matching and existing file semantics',()=>{const m={name,version:'1.2.3'};assert.equal(match(name,'1.2.3(peer@1)',m),true);assert.equal(match(name,'9.9.9',m),false);assert.equal(match(name,'file:local.tgz',m),true);});
