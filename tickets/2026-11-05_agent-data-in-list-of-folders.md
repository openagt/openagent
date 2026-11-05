Topics: agent-data, skills, settings
Issue: [#2293](https://github.com/openagt/openagent/issues/2293)

# Agent data lives in a list of folders, not in the project's repo

## TLDR

OpenAgent keeps agent data (logs, tickets, queue, plans, schedules) and skills in a list of folders, starting with one personal folder, `~/.openagent`, so adding a project changes nothing in its repo: no branch, no files.

- On first start OA creates `~/.openagent`, a git repo with no remote. A project's data sits under `projects/<project>/` in it, the project named by its repo URL.
- Optional, later: push a folder to a private repo (logs on all your machines), send one project's data to a team repo (`<org>/<project>-agent`, or the project's own repo as a branch), add a folder holding your own skills. As many folders as you want.
- The dashboard shows everything from all folders together, each item saying which folder it comes from. A project's new data goes to one folder only, never copied.
- Permissions are git access: read access to a repo shows its logs; write access lets you message an agent running on another machine.
- A folder can hold only skills, only data, or both. OA puts all skills into the agent's working copy itself (hidden from git), because Codex can't load skills from extra folders and the home folder would change every Claude/Codex session.

## Why it matters

Today every write goes through `withFileBranch(repo, 'agent-data')` in `@openagt/agent-data`: a branch of the project's own repo, pushed only when `agent-data.share` is on, and the logs, queue and tickets skill texts name the branch `agent-data`. Adding a project therefore changes its repo, and data can't be shared per team or kept across machines independently of the project.

## Plan from the issue (one PR each)

1. **Personal folder.** `~/.openagent`; `agent-data` knows "the folder a project writes to" instead of "the project's branch". Logs, tickets, queue, plans and schedules go through it.
2. **Skill texts stop naming the branch.** They say "use the command"; the command knows the folder.
3. **Folders in Settings.** The list, add a folder, give a folder a remote, "this project writes to…". Each run, ticket and skill shows which folder it comes from.
4. **Skills from every folder** are linked into the run.
5. **A ticked skill goes to the personal folder** (linked into runs like the default ones), not committed into the project's repo. Putting it in the project for everyone is a separate choice.

Later: machine settings kept in the personal repo, so a new machine is a clone (logins stay per machine: a copied Claude login logs the other machine out, and Codex refresh tokens work once; maybe Claude's `setup-token`, encrypted); messages to an agent on another machine through the data repo, shaped like the reply skill (a scheduler `when` command checks for new messages and wakes the run).

## Open

Projects that already have an `agent-data` branch: keep writing there, or move to `~/.openagent`.
