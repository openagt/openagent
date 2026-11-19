# @openagt/dashboard

**OpenAgent** — autonomous AI programming: humans make the important decisions
while coding agents run unattended.

You register your repos. From then on, agents work on them: each agent gets a throwaway
checkout of the repo, does its work, and hands the result off as a pull request. Your own
checkout is never touched.

```bash
npm i -g @openagt/dashboard

cd ~/code/my-repo
openagent          # serves the dashboard at http://127.0.0.1:4200
```

This package is OpenAgent as it ships: the packages it runs, listed in `src/distribution.ts` with
whose each is, and the `openagent` command, which serves the dashboard
([`@openagt/ui`](../ui/README.md)) with them and hands every run the skills the list gives every
run. A project installs none of them.

## The command is three options and no verbs

```
openagent              Serve the dashboard in the foreground. Ctrl+C closes it; the
                       agents it started go on to their own end.

  --port <n>           Dashboard port (default: 4200).
  -h, --help           Show this help.
  -v, --version        Print the version.
```

Everything else is the dashboard. It is the product's user interface, and where an agent's
prompt, its coding agent and its model are chosen. There is no option that begins an agent:
the command cannot start one at all.

## How it works

OpenAgent runs no coding agent and makes no model call. A Start goes to **this computer's run
host**, the `run.host` of the modules OpenAgent is distributed with (#2394): `agent-runner`'s,
which spawns the run's own process in the project with the prompt and the person's picks. From
there the run belongs to that process. A distribution names its modules in one file, which the
dashboard hands down to every run it starts (`OPENAGENT_DISTRIBUTION`); the demo's adds a host
whose runs are scripted.

The launcher's branch menu above the box says which branch the agent starts from: the
project's main branch, fetched first; **My local branch**, the branch the project's folder is
on, with its commits that are not pushed (edits that are not committed are not carried); or
another of the branches origin has now, fetched first. The pick is saved per project. The local
pick names the branch, and another of origin's its full name (`refs/remotes/origin/<branch>`),
so the run can tell them apart; `agent-runner` fetches it. The menu is shown for a project with
a remote whose folder is on a branch.

A run started from another branch origin has opens its pull request into that branch, unless the
Auto menu says main. Otherwise the pull request goes to main.

A session with no project may have repos as context, picked with **Add repo** beside "No project":
`agent-runner` copies each into the session's folder.

The session's agent (the **Agent** menu under the box) and its GitHub account (the control at
the right) go with the Start: `agent-runner` hands them to the run's process in its environment,
`OPENAGENT_AGENT` and `OPENAGENT_GIT_ACCOUNT`. An agent is a name, skills and accounts, a file in
`~/.openagent/agents/`, edited on the Agents page; the skills it can be given are handed down with
the default ones (`OPENAGENT_SKILL_CATALOGUE`).

The **Skills** menu under the box picks, for this session alone, which skills the run gets: its
agent's ticked, any other carried skill tickable, and which of the project's own skills stay in
its checkout. The picks go the same way, in `OPENAGENT_SKILLS_ON`, `OPENAGENT_SKILLS_OFF` (names,
comma-separated) and `OPENAGENT_PROJECT_SKILLS` (`all`, `none` or names): `agent-runner` links the
agent's skills less the ones off plus the ones on, and leaves the project skills not picked out of
the run's checkout with git's sparse checkout, nothing committed. The record keeps the picks, and
a resume goes on with them.

Before a Start, the launcher asks the host's check, for the picked coding agent: its
`problems` (a coding agent not installed or logged out) are said in red and its `warnings` in
amber, each line naming its own fix.

A project's `.openagent/hooks.yml` holds the shell lines that run as the dashboard opens and as
it closes: the scheduler's, which ticking its skill writes (`npx @openagt/skill-scheduler@0.1
init` in the project writes them too), until the scheduler starts and stops with the app as a
module of its own. A line finds its tools in the packages the dashboard brings first, then in the
project's installed ones; nothing is downloaded to run a line. The file's keys are `open` and
`close`; any other key is refused and the whole file ignored.

A package's own settings are no hook. The scheduler's are the scheduler package's own part of
the dashboard: its Automations page holds a switch, a pace, a number of agents at once and a
publish pick per scheduled command, its Settings entry holds how far past the quota boundary
it may start unattended work, and the handle on the usage bar is its stop line. That part reads
them with `scheduler status` and saves them with `scheduler offset`, `switch`,
`pace`, `agents` and `publish`.

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
  the dashboard, runs each project's hooks, and runs the background work — the notifications
  and the cloud sweeps.
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
