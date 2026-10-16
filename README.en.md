# DeepSeek Harness Task Runner

English | [简体中文](README.md)

Start a bounded coding task with a task description and an optional acceptance command.
Task Runner coordinates PUA and Completion Guard: a task may finish only when the
same candidate passes the frozen acceptance command, has a certificate for the
current Goal revision, and the Goal is complete. Defaults are **at most 8 rounds
and 90 minutes**. Failures may be repaired within that budget; reaching a limit
is recorded as incomplete.

This is an independent integration, not an official DeepSeek product.

## Requirements preparation

Install the composite package in Desktop and restart Harness. Version 0.3.6
uses real physical-turn handoffs and is available through the pinned GitHub
source below. It includes
unchanged SpecWorkflow 0.1.1 `to-grill` / `to-spec` skills and references with
their MIT license and byte provenance. Its registration adapter targets the
installed DSH 0.2.0-rc.2 bundled-provider SDK, including a real-SDK load check.
The upstream npm plugin declares a 0.1.x SDK peer range and is rejected by this
Desktop installer; this port grants no version exemption and does not alter the
upstream plugin's metadata. No separate SpecWorkflow installation is needed.
Version **0.3.5** defaults to the current workspace. From a model-configured
Harness conversation attached to your project, start with:

```text
/task-run --task "Describe what you want"
```

The Harness command uses the invoking conversation's workspace; the terminal
`dsh-task` command uses its current working directory. An explicit
`--workspace "/absolute/project"` overrides that default. A conversation without
a valid workspace must supply one explicitly; the Host process directory and
other conversations are never used as an implicit workspace for that command.

Omitting `--verify` starts a separate preparation conversation using the source
model settings. It loads SpecWorkflow `to-grill`, saves clarified requirements,
then loads `to-spec` and saves the specification. Only after these two no-code
stages does the adapter allow acceptance scripts to be written, in its dedicated
`.spec-workflow/prep-UUID/` directory. Production code remains unchanged.

Every acceptance criterion maps to a command and evidence files. A host-generated
dispatcher runs all criteria and fails if any fails. Review the requirements,
specification, scripts and hashes with `dsh-task review PREP_ID`. Answer questions
in the preparation conversation or with `dsh-task reply PREP_ID "answer"`.
The returned `/task-run approve PREP_ID DIGEST` (or terminal `dsh-task approve`)
confirms that exact draft, freezes its full artifact tree and starts the existing
PUA + Guard runner automatically. Any changed or added artifact invalidates the
old approval. Source changes during preparation require a fresh preparation.

Preparation cannot approve itself, edit production, run scripts or start another
Goal/workflow. The **8-round / 90-minute execution cap** begins when the reviewed
draft is approved; interviewing and waiting for human decisions do not start PUA.
Verification, repairs and recertification do not reset the execution deadline.
Generated tests still need a coverage review. The adapter requires executable
checks for every completion criterion; subjective requirements must be resolved
before execution. An existing `--verify` command retains the direct execution path
and does not invoke the preparation stages. Version 0.3.4 includes the preparation
workflow and its integration fixes. See `VALIDATION.md` for the completed live test.

## Supported environment and installation

Currently verified on **macOS / DeepSeek Harness Desktop 0.2.0-rc.2** with the
standard Agent preset and Goal service. Other clients, Web/headless profiles,
Windows/Linux and other Host versions are not claimed compatible.

In Desktop, open **Plugins → Add plugin** and install these sources in order:

| Order | Component | Source |
| --- | --- | --- |
| 1 | [Original PUA](https://github.com/MichengAI/dsh-pua) | `@michengai/dsh-pua@0.3.27` |
| 2 | [Original Completion Guard](https://github.com/GreenLv/dsh-completion-guard) | `dsh-completion-guard@0.9.0` |
| 3 | Task Runner | `github:bbskye5008/dsh-task-runner#v0.3.6` |

Keep already installed matching versions. Restart Harness after installation.
Task Runner does not automatically install its prerequisites or change model or
account settings. Desktop owns the `desktop` profile; the CLI rejects direct
`dsh plugin --profile desktop add ...` writes to that managed profile.

The repository includes runnable JavaScript: no build/prepare step is required.
For offline installation, download the Release `.tgz`, then enter its **local
absolute path** in Desktop's installer. Remote Release asset URL installation is
not a verified route for this version, so the catalog submission intentionally
omits the optional `tarball` field and uses GitHub source installation.

GitHub releases and market catalog updates are separate. Installed plugins do
not update automatically. Use the pinned source above for this release; a market
entry may still refer to a different cataloged version.

The 2026-10-16 live Chinese inventory-audit test used the same Flash/High model,
task and frozen verifiers as the previous 0.3.5 run, omitting `--workspace`.
Failure blocked certification and early Goal completion. The native Goal driver
started physical turn 2 for repairs; a plugin next-turn message started turn 3
to recertify Goal revision 2. The same candidate then finished automatically,
without a human reply: 52/52 frozen checks, 58/58 independent checks and 36
project self-tests. It used 495.411 seconds and 5/8 conservatively counted rounds
(3 PUA iterations plus 2 extra physical turns). Core regression: 73/73.
See [validation](VALIDATION.md#036-跨物理-turn-失败恢复) and [public result](validation/0.3.6.json).

## Run a task

From a normal Harness conversation with the desired model selected:

```text
/task-run --task "Implement the requested feature and add self-tests" --verify "npm test"
```

Or, with Harness running and a model-configured root conversation loaded:

```sh
node "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" \
  --workspace "/absolute/project" \
  --task "Implement the requested feature and add self-tests" \
  --verify "python3 /absolute/independent-checks/check.py"
```

Use `--task-file /absolute/task.txt` instead of `--task` for long descriptions.
`--rounds 4` or `--minutes 30` can lower, never increase, the ceilings.
The new task inherits the source conversation's model options; `--session ID`
selects a particular loaded source conversation. No model is selected by this
plugin independently of the source.

The package exposes a `dsh-task` bin. To use that short command when
`~/.local/bin` is already on your PATH, create this link once:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" "$HOME/.local/bin/dsh-task"
dsh-task --help
```

Do not overwrite an unrelated existing command. Then use:

```sh
dsh-task --task "Your full task" --verify "npm test"
dsh-task status
dsh-task status task-UUID
dsh-task diagnose task-UUID
dsh-task cancel task-UUID
```

## What the gate checks

- Generates and freezes a per-session contract, task text, discovered acceptance
  files and baseline test inventories. Add `--freeze /extra/path` for additional
  dependencies; arbitrary shell dependencies cannot all be inferred.
- Runs the exact acceptance command in a separate candidate copy. Exit 0 is
  required; printed success text is insufficient. Existing project dependencies
  must be prepared before starting; `node_modules` is reused, not reinstalled.
- Requires the phase verification record and the generated
  `TASK_GATE_PROGRESS.md` / `TASK_GATE_FINAL.md` deliverables.
- Binds acceptance and the process-private certificate to the candidate, session,
  contract, audited Host and Goal revision. A candidate edit invalidates prior
  evidence. Completing a Goal changes its revision and requires fresh signing.
- Cancels model continuation and the running acceptance process group at the
  original deadline. Each acceptance invocation is also capped at 120 seconds.
  Cancellation, limits, pause and interruption are not successful completion.
- After a Host restart, interrupted tasks do not resume automatically or receive
  another budget. The previous process's signing authority is not restored.

Acceptance commands should use relative workspace paths or
`DSH_TASK_WORKSPACE`. An absolute path pointing back to the original workspace
breaks snapshot isolation. Put newly written self-tests in `self-tests/` so they
do not replace frozen baseline tests. Evidence stays under
`~/.dsh/task-runner/task-UUID/`.

## Troubleshooting and removal

`open_a_model_configured_conversation_first` means the CLI has no loaded source
Agent. Use `/task-run` in a normal conversation or load an existing conversation
before using the CLI. `host_qualification_unavailable` means the Host version,
installation identity or actual dependency tree failed the audit: check the
supported versions rather than disabling Guard or rewriting installer metadata.
`round_limit` and `deadline` are incomplete outcomes; inspect evidence before
explicitly starting another run.

Cancel active tasks, uninstall Task Runner through Desktop's plugin manager,
and restart. Keep the original PUA/Guard packages to restore their server rows.
Evidence remains in the task-runner directory. If you created a command symlink,
remove only that link after checking its target.

## Validation, scope and attribution

[Validation record](VALIDATION.md): version 0.3.5 has 62 passing core tests,
including default workspace, explicit override and CLI directory checks. The
following real Flash / High test was completed on 0.3.4: a
Chinese CSV task went through requirements clarification, specification, generated
acceptance, digest approval, implementation and automatic completion in 1 round /
327.231 seconds. Frozen generated acceptance passed 39/39, candidate self-tests
34/34, and a separate pre-frozen business evaluator 29/29. Early Goal completion
was rejected; the same candidate was recertified after Goal revision 1 → 2.
This run demonstrates recovery within one round, not a full eight-round retry
trial. No continuous 90-minute or cross-platform validation is claimed.
Release changes are listed in [CHANGELOG.md](CHANGELOG.md).

The gate only enforces the supplied acceptance contract. It does not prove that
the command covers every requirement, authenticate every dependency byte, or
provide an OS sandbox. Certificates use a Host-process HMAC; their published
digests are not independently verifiable public signatures.

Credit to [MichengAI/dsh-pua](https://github.com/MichengAI/dsh-pua) and
[GreenLv/dsh-completion-guard](https://github.com/GreenLv/dsh-completion-guard).
Prerequisite sources resolve to the original authors' npm packages. This package
also ships attributed Apache-2.0 modified server components needed by the
candidate/Goal gate; they are not endorsed upstream releases. Original licenses,
NOTICE and baseline hashes are preserved under `vendor/`; bridge changes are
reproducible with `scripts/build-vendor.py`. Task Runner's runtime coordination
is in `index.mjs`, `guard.mjs` and `runtime/`.

License: Apache-2.0. For development, use
`npm install --ignore-scripts --legacy-peer-deps`, `npm test`, and `npm pack`.
Official SDKs are Host-shared peer dependencies.
