import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';

const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
for(const explicit of [false,true])test('CLI '+(explicit?'keeps the explicit workspace':'uses its terminal working directory'),async()=>{
 const home=mkdtempSync(join(tmpdir(),'dsh-cwd-')),cwd=join(home,'当前目录'),other=join(home,'指定目录');
 mkdirSync(cwd);mkdirSync(other);
 const socketPath=join(home,'control.sock');let received;
 const server=createServer(socket=>{
  let buffer='';socket.on('data',chunk=>{
   buffer+=chunk;if(!buffer.includes('\n'))return;
   received=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));
   socket.end(JSON.stringify({ok:true,value:{workspace:received.input.workspace}})+'\n');
  });
 });
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  writeFileSync(join(home,'control.json'),JSON.stringify({socketPath,token:'test-only'}));
  const args=[cli,'--task','中文任务'];if(explicit)args.push('--workspace',other);
  const child=spawn(process.execPath,args,{cwd,env:{...process.env,DSH_TASK_RUNNER_HOME:home},timeout:5000});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,stderr);assert.equal(received.action,'start');
  assert.equal(received.input.workspace,explicit?other:realpathSync(cwd));
  assert.equal(JSON.parse(stdout).workspace,explicit?other:realpathSync(cwd));
 }finally{
  await new Promise(resolve=>server.close(resolve));rmSync(home,{recursive:true,force:true});
 }
});
