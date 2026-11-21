Topics: agent-data, skills, settings
Issue: [#2293](https://github.com/openagt/openagent/issues/2293)

# Agent data lives in a list of folders, not in the project's repo

## TLDR

OpenAgent keeps agent data (logs, tickets, queue, plans, schedules) and skills in a list of folders, starting with a personal `~/.openagent` (a git repo with no remote), so adding a project changes nothing in its repo. Folders can get remotes (a private personal repo, a team repo like `<org>/<project>-agent`, or the project's own repo as a branch). The dashboard shows all folders together, each item saying which folder it comes from; a project's new data goes to one folder only. Permissions = git access. A folder can hold skills, data, or both; OA links every folder's skills into the agent's working copy (hidden from git).

**Already done** (#2296–#2299): personal folder `~/.openagent` as the default (shared projects keep their `agent-data` branch), skill texts stop naming the branch, Settings › Agent data (sync `~/.openagent` with a private repo), Settings › Project › Agent data (where the data is, Share switch, what is kept).

**Left:**
- A project's data in a team repo (e.g. `vikejs/vike-agent`), and the dashboard reading every folder, each item saying where it comes from.
- Skills from every folder linked into the run.
- A ticked skill goes to the personal folder (linked into runs like the default ones), not committed into the project's repo.
- Later: machine settings in the personal repo (logins stay per machine), and messages to an agent on another machine through the data repo.

Open: projects that already have an `agent-data` branch — keep writing there, or move to `~/.openagent`.

## Why it matters

Adding a project should not touch its repo, and a person's or team's logs and skills should follow them across machines and projects.
