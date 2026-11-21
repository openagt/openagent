Effort: 5
Uncertainty: 5

# [Plan] Codex on GitHub Actions needs a way to keep a ChatGPT login

How to run Codex on GitHub Actions on a ChatGPT subscription: the login it keeps, the workflow, and the driver changes.

## Problems

1. **The login.** OpenAI's CI guide (now at learn.chatgpt.com/docs/auth/ci-cd-auth) confirms that there is still no CI token. The credential is `$CODEX_HOME/auth.json` itself. Codex refreshes it when `last_refresh` is more than about 8 days old, or after a 401, and writes the new tokens back to the file. A GitHub-hosted runner starts fresh every time, so the refreshed file has to be saved somewhere and loaded again before the next run. Reloading the original seed throws the refresh away, and once the refresh token rotates, the old seed stops working. The guide also says not to share one file across concurrent jobs or machines, and not to use this on public repositories.
2. **The laptop.** If the runner refreshes a login that someone also uses on their laptop, the laptop can be logged out. The CI login has to be used only by CI.
3. **Concurrency.** Two runs that refresh the same file at once leave one of them with a revoked token. Runs that share a login have to run one after another.
4. **The transcript.** The driver reads `execution.json` with Claude's `StreamJsonParser`. On the runner, Codex runs as `codex exec --json`, which writes JSONL in its own format: `thread.started`, `turn.started`, `item.started/updated/completed` (with item types `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `todo_list`), `turn.completed` with `usage`, `turn.failed`, and `error`. Locally the driver speaks app-server, so `CodexAppServerParser` does not read this format.
5. **Resume.** Codex saves its conversations in `$CODEX_HOME/sessions`, which disappears with the runner. `codex exec resume <id>` on the next run would find nothing.

## Solutions

### Where the refreshed login is kept (problem 1)

- **A. Self-hosted runner with a persistent `CODEX_HOME`.** This is the simplest route and the one the guide recommends. A step writes the seed from a secret only when `auth.json` is missing; after that the file stays on disk and refreshes in place. All the workflow needs is a configurable `runs-on`, with the `CODEX_HOME` path taken from a repository variable.
- **B. GitHub-hosted runner, with the login written back into a repo secret.** A step before the agent writes `secrets.CODEX_AUTH_JSON` to `$RUNNER_TEMP/codex-home/auth.json`. A final step with `if: always()` compares the file's hash with the seed's and, only when it changed, runs `gh secret set CODEX_AUTH_JSON < auth.json`. `GITHUB_TOKEN` cannot write secrets, so this needs a fine-grained PAT with only "Secrets: read and write" on the one repo, stored as `CODEX_AUTH_WRITEBACK_TOKEN`. That token is given to the write-back step only, never to the agent's step. Because Codex refreshes only about every 8 days, the write-back rarely runs.
- **C. An encrypted Actions cache or artifact.** Rejected. Caches are scoped to a branch, and every turn dispatches onto its own session branch (`claude/<id>`), so one session's refresh would not be visible to the next session's runs. An artifact would need a key and a "latest" lookup, which adds more parts than B does.
- **D. Wait for OpenAI to ship a CI token.** Nothing is announced. If one ships, it replaces the seed and write-back steps and nothing else changes.

**Pick B, and get A with it.** It is the same workflow: on a persistent self-hosted runner the seed step is skipped once the file exists, and so is the write-back.

### Whose login (problem 2)

Use an account added through the existing Codex account list (`codex-accounts.ts` and `@openagt/skill-account-rotation`), never the person's own login. Add one command, e.g. `send <account> to github <owner/repo>`, which:
- runs `gh secret set CODEX_AUTH_JSON` from that account's folder;
- marks the account as CI-only in the list, so local rotation stops using it (otherwise the laptop and the runner would refresh the same token).

The docs should say plainly to use a separate ChatGPT login for CI.

### Serialized runs (problem 3)

Give the Codex job `concurrency: { group: codex-login, cancel-in-progress: false }`. GitHub keeps at most one pending run per group and cancels an older pending run when a newer one arrives. To handle that, the driver should:
- dispatch one Codex turn at a time per repo itself, with a queue inside the driver process;
- when a run ends `cancelled` and its log shows the concurrency cancellation, dispatch it again once instead of failing the turn.

### Transcript (problem 4)

Add a `CodexExecParser` to `@openagt/agent-driver-codex` that turns `codex exec --json` lines into the same `DriverEvent`s and `DriverTurn` that the app-server parser produces. The mapping:
- `thread_id` becomes `sessionId`;
- `turn.completed.usage` becomes token usage, with no `costUsd`, as the local Codex driver does;
- `agent_message` becomes the text;
- `command_execution`, `file_change`, `mcp_tool_call` and `web_search` become actions.

Check the event names against the pinned CLI version, and keep a recorded fixture of real output in the tests.

### Resume (problem 5)

Version 1 has no resume. Every Codex turn starts a fresh thread, and continuity comes from the branch, as the driver already does for the code. Leave `resume_session_id` unset for Codex and emit a `notice` saying so. A later option is to upload the session file (`sessions/**/rollout-*.jsonl`) in the artifact and have the next run fetch it with `actions/download-artifact` (`run-id` plus `github-token`) before `codex exec resume`.

## Considerations

- **Public repositories.** The agent runs unsandboxed on the runner and can read `auth.json`. On a public repo, run logs are public, so a model that prints the file leaks the login. Before the first dispatch, the driver should read the repo's visibility (`GET /repos/{owner}/{repo}`) and refuse a Codex run on a public repo, unless an explicit `allowPublicRepo` option is set.
- **Keep the login out of the workspace.** Use `CODEX_HOME=$RUNNER_TEMP/codex-home`, never the checkout, so the "commit anything left uncommitted" step cannot push it. Set `cli_auth_credentials_store = "file"` in that home's `config.toml`.
- **Failed refresh.** If the refresh fails (401 after a retry, or a revoked refresh token), the run fails. The driver should surface a clear message: run `codex login` again for the CI account and send it again.
- **Saving the refresh on failed runs.** The write-back must run with `if: always()` and after the agent step, so a turn that fails after a refresh still saves the new tokens.
- **Pinning.** Pin `@openai/codex` (`npm i -g @openai/codex@<version>`), so the transcript format the parser reads does not change under it.
- **Sandbox flag.** Run with `--dangerously-bypass-approvals-and-sandbox`, the counterpart of Claude's `--dangerously-skip-permissions`. The runner is disposable, and the workflow needs the agent's git work.
- **Framing.** Framing and the prompt travel as they do for Claude: prepended to the prompt. Pass the prompt to `codex exec` through stdin (`-`) or an env var, never interpolated into the shell.
- **Quota.** Quota is still the account's. `readQuota` stays absent.

## Implementation

1. **`@openagt/agent-driver-codex`:** add `CodexExecParser` and export it, with tests based on a recorded `codex exec --json` fixture.
2. **`@openagt/agent-driver-github-actions`:**
   - Add the option `agent: 'claude' | 'codex'` (default `'claude'`). It selects the transcript reader, with Claude's array of SDK messages and Codex's JSONL wrapped the same way in `execution.json`, and the default branch prefix (`codex/`).
   - For Codex: queue dispatches per repo, retry once on a concurrency cancel, refuse public repos, and never pass `resume_session_id`.
   - Update the package description and the class doc.
3. **`.github/workflows/openagent-agent-codex.yml`:** a sibling of `openagent-agent.yml` with the same inputs and the same artifact contract. Its steps:
   - the concurrency group;
   - set up Node and install the pinned Codex;
   - seed `auth.json` from the secret into `$RUNNER_TEMP/codex-home` (only when it is missing; this covers the self-hosted case);
   - `codex exec --json ... > openagent-run/execution.jsonl`;
   - write the login back if it changed (`if: always()`, PAT only in this step);
   - the same push-branch and artifact steps as the Claude workflow.

   `runs-on` comes from `vars.OPENAGENT_CODEX_RUNNER || 'ubuntu-latest'`, and the Codex home from `vars.OPENAGENT_CODEX_HOME || format('{0}/codex-home', runner.temp)`.
4. **Account list:** add the "send to GitHub" command and the CI-only mark. The command needs `gh` to be logged in with rights to set secrets, and it can create the write-back PAT secret only with the person's help: print the steps to create the PAT.
5. **Docs:** add setup steps to the github-actions driver's docs, using a separate ChatGPT login and a private repo, and link OpenAI's CI guide.
6. **Test against a real private repo:** run two turns on one session, then force a refresh by editing `last_refresh` in the seed to more than 8 days ago, and check that the secret was rewritten and the third turn still logs in.
