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
    ps='import { gate as unifiedGate } from '+json.dumps('../../../runtime/completion-gate.mjs')+';\n'+(ROOT/'vendor/upstream-pua-runtime.js').read_text()
    ps=replace(ps,'        if (/<promise>\\s*LOOP_DONE\\s*<\\/promise>/u.test(output)) {','        if (/<promise>\\s*LOOP_DONE\\s*<\\/promise>/u.test(output)) {\n            if (unifiedGate.required(session) && !loop.verify) { finish("paused", "Unified Completion: frozen Oracle required"); return; }')
    call='verifyLoop(subprocess, loop.verify, session.header.cwd, AbortSignal.any([signal, controller.signal, this.lifetime]), (loop.verificationTimeout ?? 120) * 1000)'
    ps=replace(ps,'const result = await '+call+';','const result = await unifiedGate.verify(session, loop.verify, () => '+call+', AbortSignal.any([signal, controller.signal, this.lifetime]));')
    ps='import { runPuaAcceptance } from "../../../runtime/acceptance.mjs";\n'+ps
    ps=ps.replace('() => '+call, '() => unifiedGate.required(session) ? runPuaAcceptance(session, AbortSignal.any([signal, controller.signal, this.lifetime])) : '+call)
    (ROOT/"vendor/guard-dist/index.js").write_text(s)
    (ROOT/"vendor/pua/lib/runtime.js").write_text(ps)
if __name__=="__main__":main()
