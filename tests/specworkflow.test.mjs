import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {hash} from '../runtime/profile-store.mjs';
const root=fileURLToPath(new URL('../vendor/specworkflow/',import.meta.url));
test('bundled SpecWorkflow stages and references retain reviewed upstream bytes and license',()=>{
 const p=JSON.parse(readFileSync(join(root,'provenance.json'),'utf8'));
 assert.equal(p.upstream.name,'specworkflow');assert.equal(p.upstream.version,'0.1.1');
 assert.deepEqual(readdirSync(join(root,'skill-package')).sort(),['to-grill','to-spec']);
 for(const [path,digest]of Object.entries(p.files))assert.equal(hash(readFileSync(join(root,path))),digest,path);
 assert(readFileSync(join(root,'LICENSE'),'utf8').includes('MIT License'));
});
