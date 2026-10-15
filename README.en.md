# DeepSeek Harness Task Runner

English | [简体中文](README.md)

Start a bounded coding task with a workspace, task description and acceptance command.
Task Runner coordinates PUA and Completion Guard: a task may finish only when the
same candidate passes the frozen acceptance command, has a certificate for the
current Goal revision, and the Goal is complete. Defaults are **at most 8 rounds
and 90 minutes**. Failures may be repaired within that budget; reaching a limit
is recorded as incomplete.

This is an independent integration, not an official DeepSeek product.

## Supported environment and installation

Currently verified on **macOS / DeepSeek Harness Desktop 0.2.0-rc.2** with the
standard Agent preset and Goal service. Other clients, Web/headless profiles,
Windows/Linux and other Host versions are not claimed compatible.

In Desktop, open **Plugins → Add plugin** and install these sources in order:

| Order | Component | Source |
| --- | --- | --- |
| 1 | [Original PUA](https://github.com/MichengAI/dsh-pua) | `@michengai/dsh-pua@0.3.27` |
| 2 | [Original Completion Guard](https://github.com/GreenLv/dsh-completion-guard) | `dsh-completion-guard@0.9.0` |
| 3 | Task Runner | `github:bbskye5008/dsh-task-runner#v0.2.2` |

Keep already installed matching versions. Restart Harness after installation.
Task Runner does not automatically install its prerequisites or change model or
account settings. Desktop owns the `desktop` profile; the CLI rejects direct
`dsh plugin --profile desktop add ...` writes to that managed profile.

The repository includes runnable JavaScript: no build/prepare step is required.
For offline installation, download the Release `.tgz`, then enter its **local
absolute path** in Desktop's installer. Remote Release asset URL installation is
not a verified route for this version, so the catalog submission intentionally
omits the optional `tarball` field and uses GitHub source installation.

Market discovery requires the catalog PR to be merged and its catalog to sync.
Until then, install using the source above. Market users still need the two
prerequisites and a restart.

## Run a task

From a normal Harness conversation with the desired model selected:

```text
/task-run --workspace "/absolute/project" --task "Implement the requested feature and add self-tests" --verify "npm test"
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
dsh-task --workspace "/absolute/project" --task "Your full task" --verify "npm test"
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

[Validation record](VALIDATION.md): 36 core tests; a Flash / High task baseline
completed automatically in 2 rounds and 307 seconds with independent acceptance
and 22 candidate self-tests. The final 0.2.2 GitHub installation was separately
restarted and checked with a real rejection/round-limit regression. Deadline
probes used shorter budgets; no claim of a continuous 90-minute trial or
cross-platform validation is made.

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
