// Run with the installed Desktop's Electron-as-Node. This checks the real
// bundled SDK without installing into or modifying the managed profile.
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const sdkRoot=process.env.DSH_TASK_SDK_ROOT;
if(!sdkRoot)throw Error('Set DSH_TASK_SDK_ROOT to the installed app.asar/dsh directory');
const hostParent=pathToFileURL(join(sdkRoot,'package.json')).href;
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@deepseek-ai/')&&!context.parentURL?.startsWith(pathToFileURL(sdkRoot).href))return next(specifier,{...context,parentURL:hostParent});
  return next(specifier,context);
}});
const root=fileURLToPath(new URL('../',import.meta.url));
const {createProvider}=await import(pathToFileURL(join(root,'specworkflow.mjs')));
const {installPreparationHost}=await import(pathToFileURL(join(root,'runtime/preparation-host.mjs')));
const {parseInput}=await import(pathToFileURL(join(root,'runtime/input.mjs')));
const {assertObjectJsonSchema}=await import('@deepseek-ai/dsh-tools');
const control=new AbortController(),warnings=[];
const ctx={get:()=>undefined,logger:{warn:(...a)=>warnings.push(a)}};
const provider=createProvider(ctx,{signal:control.signal,invalidate(){}});
try{
  assert.equal(provider.includeDefaultRoots,false);
  const observed=await provider.list({cwd:resolve(process.argv[2]??root)});
  const list=Array.isArray(observed)?observed:observed.candidates;
  assert.deepEqual(list.map(x=>x.name).sort(),['to-grill','to-spec']);
  const loaded=[];
  for(const candidate of list){
    const skill=await provider.get(candidate,{});
    assert.equal(skill.provider,'task-runner-specworkflow');
    assert.equal(skill.resourceBase.kind,'directory');
    assert(skill.content.length>1000);
    const language=readFileSync(join(skill.resourceBase.path,'references/bilingual-output.md'),'utf8');
    assert(language.length>1000);
    assert.equal(candidate.source,'bundled');
    loaded.push({name:skill.name,provider:skill.provider,contentLength:skill.content.length,path:skill.path});
  }
  assert.deepEqual(warnings,[]);
  // Exercise the actual preparation definitions through the actual SDK compiler.
  // The agent factory/start below are test doubles: this is not a live LLM run.
  const scratch=mkdtempSync(join(tmpdir(),'dsh-preparation-sdk-'));
  const home=join(scratch,'home'),workspace=join(scratch,'workspace');mkdirSync(workspace);
  const definitions=new Map(),listeners=new Map(),guards=[],effects=[],launches=[];let prepAgent;
  const origin={session:{header:{agentPreset:'standard'}},ctx:{},options:{provider:'test-provider',model:'test-model'}};
  const hostCtx={get:key=>key==='skills'?{get:async name=>provider.get(list.find(x=>x.name===name),{})}:undefined,
    logger:{warn:(...a)=>warnings.push(a)},agentPresets:{mount:async()=>{},composedPreset:()=>null},
    tools:{guard:fn=>guards.push(fn)},on:(name,fn)=>listeners.set(name,fn),effect:fn=>effects.push(fn),
    agents:{create:async options=>{
      await options.setup({tools:{register:definition=>{
        assertObjectJsonSchema(definition.parameters);
        definitions.set(definition.name,definition);
      }}});
      prepAgent={session:{id:options.sessionId},ctx:{},options:options.agentOptions,followup(){},cancel(){}};
      return {agent:prepAgent,dispose:async()=>{}};
    }}};
  try{
    const host=installPreparationHost(hostCtx,{home,latestOrigin:()=>origin,start:async input=>{launches.push(input);return {id:'task-11111111-1111-4111-8111-111111111111',status:'active'};}});
    const prep=await host.prepare(parseInput(JSON.stringify({workspace,task:'验证需求准备、具体规格与独立验收交接。'}),{allowPreparation:true}),origin);
    assert.deepEqual([...definitions.keys()].sort(),['task_prepare_generate','task_prepare_submit','task_prepare_write']);
    for(const d of definitions.values())assert.equal(d.parameters.type,'object',d.name);
    assert.deepEqual(definitions.get('task_prepare_generate').parameters.properties,{});
    assert.deepEqual(definitions.get('task_prepare_write').parameters.required,['path','content']);
    assert.equal(launches.length,0);
    await assert.rejects(()=>host.approve(prep.id,'unapproved',origin),/not_awaiting_approval/);
    const guard=guards[0];assert(guard({agent:prepAgent,name:'write',arguments:{file_path:'production.py'}}));
    const execute=async(name,args)=>{
      const denial=guard({agent:prepAgent,name,arguments:args});
      assert.equal(denial,undefined,name+' must pass the actual preparation guard');
      return definitions.get(name).execute(args,{});
    };
    const skillEvent=name=>listeners.get('tools/result')({agent:prepAgent,name:'skill',arguments:{name}},{isError:false});
    skillEvent('to-grill');
    const write=(path,content)=>execute('task_prepare_write',{path,content});
    await assert.rejects(()=>write('../production.py','bad'),/finish_spec|outside_workspace/);
    await write('requirements.md','已关闭问题，业务范围、输出、错误和验收口径均已确认。'.repeat(8));
    skillEvent('to-spec');await write('spec.md','明确规格与执行边界，正常输入和错误输出均有可检查标准。'.repeat(8));
    await execute('task_prepare_generate',{});
    await write('acceptance/check.py','raise SystemExit(0)\n');
    await write('acceptance.json',JSON.stringify({schema:'dsh-task-preparation/v1',requirements:'requirements.md',spec:'spec.md',openQuestions:[],criteria:[{id:'AC01',description:'SDK 机械交接检查，不代表业务验收完成',command:'python3 .spec-workflow/'+prep.id+'/acceptance/check.py',evidenceFiles:['acceptance/check.py']}]}));
    const review=await execute('task_prepare_submit',{});
    assert.equal(review.status,'awaiting_approval');assert.equal(launches.length,0);
    await host.approve(prep.id,review.digest,origin);
    assert.equal(launches.length,1);assert.equal(launches[0].rounds,8);assert.equal(launches[0].minutes,90);assert.equal(launches[0].preparation.digest,review.digest);
    await assert.rejects(()=>host.approve(prep.id,review.digest,origin),/not_awaiting_approval/);
    assert.equal(launches.length,1);
  }finally{for(const effect of effects)await effect()();rmSync(scratch,{recursive:true,force:true});}
  console.log(JSON.stringify({protocol:'specworkflow-real-sdk-smoke/v1',ok:true,loaded,warnings,hostTools:{objectSchemas:3,typedArguments:true,unapprovedStartRejected:true,approvedHandoffCount:launches.length,duplicateApprovalRejected:true,executionCaps:{rounds:8,minutes:90},agentFactoryAndStart:'test-doubles-no-live-model'}},null,2));
}finally{control.abort();await provider.dispose();}
