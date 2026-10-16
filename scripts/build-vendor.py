from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent.parent
def replace(s,a,b):
 assert s.count(a)==1, a[:100]
 return s.replace(a,b)
def main():
    gate="../../runtime/completion-gate.mjs";native="../../runtime/native-task.mjs"
    s=(ROOT/"vendor/upstream-guard-index.js").read_text()
    s="import { gate as unifiedGate } from "+json.dumps(gate)+";\nimport { nativeTaskFor, existingNativeTask } from "+json.dumps(native)+";\n"+s
    s=replace(s,'const ownedTools = {\n\t\t\tregister: (...args) => own(agent.ctx.tools.register(...args)),','let nativeTask;\n\t\tconst ownedTools = {\n\t\t\tregister: (...args) => { if (nativeTask) args[0] = nativeTask.wrapTool(args[0]); return own(agent.ctx.tools.register(...args)); },')
    anchor='const { runtime, created } = ensure(agent);\n\t\t\tif (!created) runtime.sync();'
    s=replace(s,anchor,anchor+'''
            nativeTask = nativeTaskFor(agent, runtime, async () => {
                const durable = await ctx.sessions.flush(agent.session);
                runtime.setDurability(durable); runtime.sync(); return durable;
            });
            if (nativeTask) {
                own(unifiedGate.registerGuard(agent.session, () => nativeTask.view()));
                own(agent.ctx.tools.register(defineTool(nativeTask.phaseTool())));
            }
''')
    s=replace(s,'runtimes.set(agent, runtime);', '''runtime.activationDiagnostic = {source:startSources.get(agent), initialization, hostLock:{status:agentHostLock.status,reasonCode:agentHostLock.reasonCode,goalAvailable:agentHostLock.goalAvailable,liveGoalAvailable:agentHostLock.liveGoalAvailable}, liveAgent:ctx.get?.("agents")?.get(agent.id)===agent, liveSession:ctx.sessions.get?.(agent.session.id)===agent.session, updateGoalTool:agent.ctx.tools?.get?.("update_goal",agent)?.parameters};
            runtimes.set(agent, runtime);''')
    s=replace(s,'if (privateDenial) return privateDenial;','if (privateDenial) return privateDenial;\n                if (nativeTask) return nativeTask.toolDenial(exec.name, exec.arguments);')
    s=replace(s,'const injected = [];\n\t\tconst delegated','''const injected = [];
        const native = existingNativeTask(agent);
        if (native) {
            if (!native.initialized) {
                native.initialized = true;
                decision.messages = [createUserMessage({ content: [{ type: "text", text: "Context Guard protocol boundary: native-file-contract/v1" }], source: { kind: "context-guard", plugin: "context-guard", form: "notice", summary: "Configured file contract" } }), ...decision.messages];
            }
            return decision;
        }
\t\tconst delegated''')
    s=replace(s,'ctx.on("agent/turn-stopping", async ({ agent }) => {\n\t\tconst { runtime }','ctx.on("agent/turn-stopping", async ({ agent }) => {\n        const native = existingNativeTask(agent);\n        if (native) { if (native.pauseRequested()) await qualifiedGoalService(agent)?.disarm(agent); return; }\n\t\tconst { runtime }')
    ps='import { handoffTaskLoop, isFinalCompletionPromise } from "../../../runtime/turn-handoff.mjs";\nimport { gate as unifiedGate } from '+json.dumps('../../../runtime/completion-gate.mjs')+';\n'+(ROOT/'vendor/upstream-pua-runtime.js').read_text()
    ps=replace(ps,'        if (/<promise>\\s*LOOP_DONE\\s*<\\/promise>/u.test(output)) {','        if (unifiedGate.required(session) ? isFinalCompletionPromise(output) : /<promise>\\s*LOOP_DONE\\s*<\\/promise>/u.test(output)) {\n            if (unifiedGate.required(session) && !loop.verify) { finish("paused", "Unified Completion: frozen Oracle required"); return; }')
    call='verifyLoop(subprocess, loop.verify, session.header.cwd, AbortSignal.any([signal, controller.signal, this.lifetime]), (loop.verificationTimeout ?? 120) * 1000)'
    ps=replace(ps,'const result = await '+call+';','const result = await unifiedGate.verify(session, loop.verify, () => '+call+', AbortSignal.any([signal, controller.signal, this.lifetime]));')
    ps='import { runPuaAcceptance } from "../../../runtime/acceptance.mjs";\n'+ps
    ps=ps.replace('() => '+call, '() => unifiedGate.required(session) ? runPuaAcceptance(session, AbortSignal.any([signal, controller.signal, this.lifetime])) : '+call)
    continuation='        agent.steer(pluginMessage(`▎ 第 ${loop.iteration} 轮。${pressure}\\n${note}\\n任务：${loop.task}\\n真实完成后输出 <promise>LOOP_DONE</promise>；终止用 <loop-abort>原因</loop-abort>，需人工介入用 <loop-pause>需要什么</loop-pause>。`));'
    ps=replace(ps,continuation,'        const continuation = pluginMessage(`▎ 第 ${loop.iteration} 轮。${pressure}\\n${note}\\n任务：${loop.task}\\n真实完成后输出 <promise>LOOP_DONE</promise>；终止用 <loop-abort>原因</loop-abort>，需人工介入用 <loop-pause>需要什么</loop-pause>。`);\n        if (!handoffTaskLoop(agent, continuation, loop.iteration)) agent.steer(continuation);')
    ds='import { taskRunnerGuardOwner } from "../../runtime/bundled-owner.mjs";\nimport { installedReferenceMatches } from "../../runtime/installation-identity.mjs";\n'+(ROOT/'scripts/upstream-guard-domain.js').read_text()
    ds=replace(ds,'if (manifest.name !== name || typeof manifest.version !== "string" || !version$1.startsWith("file:") && manifest.version !== version$1.split("(", 1)[0]) throw Error("Desktop installation identity mismatch");', 'if (!installedReferenceMatches(name, version$1, manifest, {critical:CRITICAL_NAMES.includes(name),lockText:session.readFile(join(profile,"pnpm-lock.yaml")).toString("utf8"),profileManifest:session.readJson(join(profile,"package.json"))})) throw Error("Desktop installation identity mismatch");')
    ds=replace(ds,'function verifyDesktopPluginIdentity(profileRoot, expectedPluginVersion) {','function verifyDesktopPluginIdentity(profileRoot, expectedPluginVersion = "0.9.0") {\n    const compositeOwner = taskRunnerGuardOwner(profileRoot, expectedPluginVersion);\n    if (compositeOwner) return compositeOwner;')
    ds=replace(ds,'installed profile plugin identity does not match the generator version");\n}\n/** One desktop evaluation:', 'installed profile plugin identity does not match the generator version");\n    return pluginManifestPath;\n}\n/** One desktop evaluation:')
    ds=replace(ds,'const pluginManifestPath = join(profile, "node_modules", "dsh-completion-guard", "package.json");\n\tconst installedPlugin = session.readJson(pluginManifestPath);\n\tverifyDesktopPluginIdentity(profile, String(installedPlugin.version));','const pluginManifestPath = verifyDesktopPluginIdentity(profile);')
    (ROOT/'vendor/guard-dist/domain-CRL0HSOC.js').write_text(ds)
    (ROOT/"vendor/guard-dist/index.js").write_text(s)
    (ROOT/"vendor/pua/lib/runtime.js").write_text(ps)
if __name__=="__main__":main()
