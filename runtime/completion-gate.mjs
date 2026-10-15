import {assertRun,runFor} from './profile-store.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, readlinkSync, appendFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value);

// The whole candidate is bound, including documentation, tests and symlinks.
// Only interpreter caches are excluded, matching the frozen verifier's scope.
export function candidateDigest(cwd) {
  const rows = [];
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (['__pycache__','.git','node_modules','.scratch','.pytest_cache','.mypy_cache','.ruff_cache'].includes(name)) continue;
      const file = join(dir, name), stat = lstatSync(file);
      const key = relative(cwd, file).split('\\').join('/');
      if (stat.isSymbolicLink()) rows.push([key, 'symlink', readlinkSync(file)]);
      else if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) rows.push([key, 'file', hash(readFileSync(file))]);
      else throw new Error('unsupported_candidate_entry:' + key);
    }
  }
  visit(cwd);
  return hash(canonical(rows));
}

export class CompletionGate {
  constructor(targets, { log, integrity = () => {} } = {}) {
    this.targets = new Map(targets.map(t => [resolve(t.cwd), Object.freeze({ ...t })]));
    this.states = new WeakMap();
    this.log = log;
    this.integrity = integrity;
  }
  target(session) { return this.targets.get(resolve(session.header.cwd || '/__missing_cwd__')); }
  required(session) { return !!this.target(session); }
  state(session) {
    let state = this.states.get(session);
    if (!state) { state = {}; this.states.set(session, state); }
    return state;
  }
  record(session, type, data) {
    this.log?.({ at: new Date().toISOString(), session: String(session.id), type, ...data });
  }
  registerGuard(session, readGuard) {
    this.state(session).readGuard = readGuard;
    return () => { this.states.delete(session); };
  }
  view(session) {
    this.integrity(session);
    const read = this.state(session).readGuard;
    if (!read) throw new Error('guard_unavailable');
    const view = read(); // Production refreshes/revalidates the real Guard projection.
    if (!view.enabled || view.integrity !== 'valid' || view.hostStatus !== 'supported')
      throw new Error('guard_unavailable_or_invalid');
    return view;
  }
  identity(session, view) {
    return canonical([String(session.id), resolve(session.header.cwd), view.epoch,
      view.sessionRefDigest, view.hostLockDigest, view.contractRevision,
      view.currentGoalRef || null, view.rootLocatorIdentity || null]);
  }
  certificate(session, candidate, view) {
    const anchor = this.state(session).anchor;
    if (!view.currentCertificate || !view.certificateDigest)
      return 'certificate_missing_or_stale:' + (view.certificateReason || 'missing');
    if (!anchor) return 'certificate_candidate_binding_missing';
    if (anchor.digest !== view.certificateDigest || anchor.identity !== this.identity(session, view))
      return 'certificate_binding_stale';
    if (anchor.candidate !== candidate) return 'candidate_changed_since_certificate';
  }
  // Wrapping the actual Guard checkpoint preserves its certifier. No synthetic
  // certificate, passed obligation, clear, rebind or disabled-Guard fallback.
  wrapCheckpoint(session, tool) {
    if (!this.required(session)) return tool;
    const gate = this, execute = tool.execute;
    return { ...tool, async execute(...args) {
      const before = candidateDigest(session.header.cwd);
      const result = await execute.apply(tool, args);
      const after = candidateDigest(session.header.cwd);
      const digest = result?.certificate?.certification_digest;
      if (result?.status === 'certified' && digest && before === after) {
        const view = gate.view(session);
        gate.state(session).anchor = { digest, candidate: after, identity: gate.identity(session, view) };
        gate.record(session, 'certificate_bound', gate.state(session).anchor);
      } else if (result?.status === 'certified') {
        delete gate.state(session).anchor;
        gate.record(session, 'certificate_binding_rejected', { reason: 'missing_digest_or_candidate_changed' });
      }
      return result;
    } };
  }
  check(session) {
    if (!this.required(session)) return { ok: true, required: false };
    try {
      const candidate = candidateDigest(session.header.cwd), view = this.view(session);
      const reason = this.certificate(session, candidate, view);
      if (reason) return { ok: false, reason };
      const receipt = this.state(session).receipt;
      if (!receipt) return { ok: false, reason: 'acceptance_missing' };
      if (receipt.candidate !== candidate || receipt.identity !== this.identity(session, view))
        return { ok: false, reason: 'acceptance_candidate_or_contract_stale' };
      return { ok: true, required: true, candidate, certificate: view.certificateDigest };
    } catch (error) { return { ok: false, reason: String(error.message || error) }; }
  }
  goalDenial(session, toolName, args) {
    if (!this.required(session) || toolName !== 'update_goal' || args?.action !== 'complete') return;
    const verdict = this.check(session);
    this.record(session, 'goal_completion_check', verdict);
    if (!verdict.ok) return `Unified Completion denial [${verdict.reason}]: both current candidate acceptance and the real Guard certificate are required.`;
  }
  async verify(session, command, run, signal) {
    if (!this.required(session)) return run();
    const state = this.state(session), target = this.target(session);
    if (state.busy) return { ok: false, detail: 'Unified Completion: verification_in_flight' };
    state.busy = true;
    delete state.receipt; // A new failure can never inherit an earlier pass.
    try {
      signal?.throwIfAborted();
      if (command !== target.command) throw new Error('verification_command_mismatch');
      const before = candidateDigest(session.header.cwd), first = this.view(session);
      const identity = this.identity(session, first);
      const result = await run();
      signal?.throwIfAborted();
      const after = candidateDigest(session.header.cwd), view = this.view(session);
      if (before !== after) throw new Error('candidate_changed_during_acceptance');
      if (identity !== this.identity(session, view)) throw new Error('guard_contract_changed_during_acceptance');
      if (!result.ok) {
        this.record(session, 'acceptance_rejected', { candidate: after, detail: result.detail });
        return result;
      }
      state.receipt = { candidate: after, identity, command };
      let verdict = this.check(session);
      if (verdict.ok && target.requireGoalComplete && view.goalPhase !== 'complete')
        verdict = { ok: false, reason: 'native_goal_not_complete' };
      this.record(session, 'pua_completion_check', verdict);
      return verdict.ok ? { ok: true, detail: JSON.stringify({ unified: verdict, oracle: result.detail }) }
        : { ok: false, detail: JSON.stringify({ oraclePassed: true, oracle: result.detail, unified: verdict,
            instruction: 'Do not off/clear/rebind or invent a certificate. Finish all deliverables before a genuine context_guard_checkpoint. Any candidate change requires new acceptance and certification. A Goal revision change also requires a fresh checkpoint. If certification is impossible report uncertified; never claim unified completion.' }) };
    } catch (error) {
      delete state.receipt;
      this.record(session, 'completion_rejected', { reason: String(error.message || error) });
      return { ok: false, detail: 'Unified Completion: ' + String(error.message || error) };
    } finally { state.busy = false; }
  }
}

export const gate = new CompletionGate([], {integrity:session=>assertRun(runFor(session)),log:entry=>runFor(entry.session)?.log(entry.type,entry)});
gate.target = session => {const run=runFor(session);return run?{cwd:run.p.cwd,command:run.p.acceptance.command,requireGoalComplete:true}:undefined;};
