# @openagt/dashboard

**OpenAgent** — autonomous AI programming: humans make the important decisions
while coding agents run unattended.

You register your repos. From then on, agents work on them: each agent gets a throwaway
checkout of the repo, does its work, and hands the result off as a pull request. Your own
checkout is never touched.

```bash
npx @openagt/install   # starts at login, at https://openagent.build, and puts `openagent` on the PATH

cd ~/code/my-repo
openagent              # adds the repository to the dashboard's projects, and opens its page
```

This package is OpenAgent as it ships: the packages it runs, listed in `src/distribution.ts` with
whose each is and which plugins start on, and the `openagent` command, which serves the dashboard
([`@openagt/ui`](../ui/README.md)) with them. A project installs none of them.

The core modules are always on. A plugin has an Enabled row each, switched in **Settings ›
Plugins**: `ask` and desktop notifications while the dashboard is open (**Settings ›
Notifications**) start on, every other plugin starts off (the command this computer runs when a
run needs you, typed in **Settings › Notification command**, the tickets, the queue, the logs, the browser, the scheduler,
Discord, the commands that move a ticket to work, a mermaid block drawn as its diagram, GitHub
Actions, which "Run on" then offers beside this computer in a project whose repository has the
workflow it brings, and Claude Code on the web, which "Run on" then offers in a project on GitHub,
through the browser extension it brings, set up in **Settings › Claude web**). The two git stores
are on as their repositories stand: your folder's sync with a repository of yours, set in **Settings
› Your agent data**, and a project's data on its own repository, set in the project's **Project
agent data**. A run gets the skills of the core modules (github's on a GitHub project) and of the
plugins on in its project, linked into its checkout; nothing is written into the project.

## The command is four options and no verbs

```
openagent              Serve the dashboard in the foreground. Ctrl+C closes it; the
                       agents it started go on to their own end.

  --port <n>           Dashboard port (default: 4200).
  -h, --help           Show this help.
  -v, --version        Print the version.
  --uninstall          Take OpenAgent off this computer: everything `npx @openagt/install`
                       put on it, this command too.
```

Everything else is the dashboard. It is the product's user interface, and where an agent's
prompt, its coding agent and its model are chosen. There is no option that begins an agent:
the command cannot start one at all.

## How it works

OpenAgent runs no coding agent and makes no model call. A Start goes to **this computer's run
host**, the `run.host` of the modules OpenAgent is distributed with (#2394): `agent-driver`'s,
which spawns the run's own process in the project with the prompt and the person's picks. From
there the run belongs to that process. A distribution names its modules in one file, which the
dashboard hands down to every run it starts (`OPENAGENT_DISTRIBUTION`); the demo's adds a host
whose runs are scripted.

The launcher's branch menu above the box says which branch the agent starts from: the
project's main branch, fetched first; **My local branch**, the branch the project's folder is
on, with its commits that are not pushed (edits that are not committed are not carried); or
another of the branches origin has now, fetched first. The pick is saved per project. The local
pick names the branch, and another of origin's its full name (`refs/remotes/origin/<branch>`),
so the run can tell them apart; `agent-driver` fetches it. The menu is shown for a project with
a remote whose folder is on a branch.

A run started from another branch origin has opens its pull request into that branch, unless the
Auto menu says main. Otherwise the pull request goes to main.

A session with no project may have repos as context, picked with **Add repo** beside "No project":
`agent-driver` copies each into the session's folder.

The session's profile and its GitHub account (the **Profile** and **GitHub account** lines of the
gear's menu under the box) go with the Start: `agent-driver` hands them to the run's process in its environment,
`OPENAGENT_PROFILE` and `OPENAGENT_GIT_ACCOUNT`. A profile is a name and a saved set of run options
(its accounts, the plugins its runs go without, and the project skills they get), kept with the
person and edited on the Profiles page; the run reads it as it starts, and again when it
resumes.

The **Skills** line of the gear's menu picks, for this session alone, which skills the run gets: the
plugins on in the project, each ticked, tickable off, and which of the project's own skills stay
in its checkout, both as the profile has them until the session picks. The picks go the same way,
in `OPENAGENT_PLUGINS_WITHOUT` (names, comma-separated; set to nothing, none of them) and
`OPENAGENT_PROJECT_SKILLS` (`all`, `none` or names), the profile's where one is unset: the run
gets none of the skills or steps of a plugin it goes without, and the project skills not picked
are left out of its checkout with git's sparse checkout, nothing committed. The record keeps the
picks, and a resume goes on with them.

Before a Start, the launcher asks the host's check, for the picked coding agent: its
`problems` (a coding agent not installed or logged out) are said in red and its `warnings` in
amber, each line naming its own fix.

A project's scheduler runs for as long as OpenAgent does wherever scheduled-agents is on: it
starts as OpenAgent starts, as the project is added and within a minute of the plugin being
switched on there, and stops as OpenAgent stops and as the project is removed, unless it was set
to keep running, and within a minute of the plugin being switched off.

A package's own settings are no hook. The scheduler's are the scheduler package's own part of
the dashboard: its Automations page holds a switch, a pace, a number of agents at once and a
publish pick per scheduled command, its Settings entry holds how far past the quota boundary
it may start unattended work, and the handle on the usage bar is its stop line. That part reads
them through the package's server part, as `scheduler status` says them, and saves them with
`scheduler offset`, `switch`, `pace`, `agents`, `agent`, `model` and `publish`.

The dashboard is a **projection of the agent's own files**. The agent's tool keeps the
agent's card (`<id>.json`) and diary (`<id>.jsonl`) under `.openagent/` in the agent's
checkout, and copies both onto the project's `agent-data` branch when the agent ends.
Everything the dashboard shows — live, and months later — it reads from those two files.

Steering goes back the same way, never over a channel:

- **What you say to a working agent** becomes a line in its `inbox.jsonl`, which the agent's
  tool reads while the agent works: the agent reads it at its next step, or, sent with ⌘Enter,
  when its turn ends.
- **What you say to an agent that has ended** — your words, or your answer to the question it
  stopped on — goes to the run's host, which continues that same agent.
- **Stop** is a signal to the process the agent's card names: the agent ends its turn where it is,
  and a message continues it.

So a working agent and a finished one render identically, and an agent on another machine
needs only its lines carried home.

- **One daemon per machine.** Running the CLI in any registered repo finds it. It serves
  the dashboard, runs each project's hooks, and runs the background work — the cloud sweeps.
- **An agent is one task being worked**, in its own checkout on its own branch. You can watch
  it, answer its questions, and say more to it — or not be there at all.
- **What you can ask for is your project's own commands**: its skills, read from
  `.claude/skills/` and `.agents/skills/`, plus free text and the prompts you save.
  OpenAgent ships no prompt text.
- **Work leaves as a pull request**, opened by the agent itself. An agent that committed
  nothing publishes nothing.

## Layout

- `src/distribution.ts` — the modules OpenAgent runs, a package or a module each, handed down to
  every process the dashboard starts.
- `src/bin.ts` — `openagent`: `@openagt/ui`'s command, serving them.

The dashboard itself, its server and its command are [`@openagt/ui`](../ui/README.md).

## Status

Pre-release, published from the `0.x` line. There are no users to keep compatible,
so the code prefers being clean over being backward-compatible.
