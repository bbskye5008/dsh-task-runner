import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {Service} from '@deepseek-ai/cordis';
import {apply as guardApply,Config,resolveDesktopProfileHostLock} from './vendor/guard-dist/index.js';
export {Config};
export const name='task-runner-guard';
export const inject=['sessions','commands','fs'];
export class TaskRunnerHost extends Service {
  constructor(ctx,qualification){super(ctx,'taskRunnerHost');this.qualification=qualification;}
}
export function apply(ctx,raw={}) {
  let config={...raw},qualification;
  try {
    const root=process.env.DSH_TASK_RUNNER_PROFILE||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'profiles','desktop');
    const host=fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-agent/package.json'));
    if(!host.includes('.asar/'))throw Error('only_audited_desktop_host_supported_in_0_2_0');
    const archive=host.slice(0,host.indexOf('.asar/')+5);
    let trust;
    const patch=join(root,'cordis.patch.yml');
    if(existsSync(patch)){
      const schema=yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:s=>({unevaluated:s})}));
      const rows=yaml.load(readFileSync(patch,'utf8'),{schema})??[];
      const prior=rows.filter(x=>x.id==='context-guard'&&x.config?.hostLockTrust).at(-1);
      if(prior)trust=JSON.parse(prior.config.hostLockTrust);
    }
    const active=resolveDesktopProfileHostLock(archive,root,'0.9.0',trust);
    if(active.evaluation.status!=='supported')throw Error('audited_host_not_supported');
    config={...config,activation:'opt-in',hostLockPolicy:'dsh-core/v1',hostLockRuntimeRoot:active.runtimeRoot,hostLockProfileRoot:active.profileRoot,hostLockPlatform:active.platform,hostLockProfile:'desktop',hostLockPackages:active.evaluation.packages,hostLockDesktopDigest:active.evaluation.digest,...active.trust?{hostLockTrust:JSON.stringify(active.trust)}:{}};
    qualification={status:'supported',digest:active.evaluation.digest};
  }catch(e){qualification={status:'unavailable',reason:String(e)};ctx.logger.error('Task Runner host qualification unavailable: %s',String(e));}
  const result=guardApply(ctx,config);new TaskRunnerHost(ctx,qualification);return result;
}
