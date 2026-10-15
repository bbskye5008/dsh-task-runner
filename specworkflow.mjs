import {fileURLToPath} from 'node:url';
import {FileSystemSkillProvider} from '@deepseek-ai/dsh-skill-filesystem';

export const name='task-runner-specworkflow';
export const inject=['skills'];
export const skillRoot=fileURLToPath(new URL('./vendor/specworkflow/skill-package',import.meta.url));
export function createProvider(ctx,control){
  // This is a current-SDK port, not a version exemption for the upstream
  // 0.1.x plugin. Only its two unchanged, attributed skill bundles are shipped.
  // A trusted bundled root avoids default project/user rescans and watchers.
  return new FileSystemSkillProvider(ctx,control,{
    providerName:'task-runner-specworkflow',
    includeDefaultRoots:false,
    bundledSkillDir:skillRoot,
    watch:false,
  });
}
export function apply(ctx){
  let provider;
  ctx.skills.registerProvider(control=>(provider=createProvider(ctx,control)));
  ctx.effect(()=>async()=>{await provider?.dispose();});
}
