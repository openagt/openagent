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

Before this work every write went through `withFileBranch(repo, 'agent-data')` in `@openagt/agent-data`: a branch of the project's own repo, and the skill texts named the branch `agent-data`. Adding a project therefore changed its repo, and data couldn't be shared per team or kept across machines independently of the project.

## Done

- #2296: a project's agent data goes to `~/.openagent` by default. A shared project keeps its own `agent-data` branch (this settles the earlier open question).
- #2297: the skill texts stop naming the branch.
- #2298: Settings › Agent data: `~/.openagent` can sync with a private repo, so each computer has the same data.
- #2299: Settings › Project › Agent data: where the project's data is (the Share switch moved here), and what is kept.

## Left (one PR each)

1. **A project's data in a team repo** (e.g. `vikejs/vike-agent`), and the dashboard reading every folder, each run, ticket and skill saying which folder it comes from.
2. **Skills from every folder** are linked into the run.
3. **A ticked skill goes to the personal folder** (linked into runs like the default ones), not committed into the project's repo. Putting it in the project for everyone is a separate choice.

Later: machine settings kept in the personal repo, so a new machine is a clone (logins stay per machine: a copied Claude login logs the other machine out, and Codex refresh tokens work once; maybe Claude's `setup-token`, encrypted); messages to an agent on another machine through the data repo, shaped like the reply skill (a scheduler `when` command checks for new messages and wakes the run).
