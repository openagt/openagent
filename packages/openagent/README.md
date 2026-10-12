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

## The CLI is three options and no verbs

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

OpenAgent runs no coding agent and makes no model call. Starting an agent is running
**one shell line the project itself names** — its `start` hook, in the project's own
`.openagent/hooks.yml`:

```yaml
start: agent-runner run --detach "$PROMPT" ${DRIVER:+--driver "$DRIVER"} ${MODEL:+--model "$MODEL"} ${THEN:+--then "$THEN"} ${PUBLISH:+--publish "$PUBLISH"} ${BASE:+--base "$BASE"}
resume: agent-runner run --detach --resume "$RUN_ID" ${TEXT:+"$TEXT"} ${ANSWER:+--answer "$ANSWER"}
check: agent-runner check ${DRIVER:+--driver "$DRIVER"}
```

The line is given the prompt and the user's picks in its environment, and answers one JSON
document whose `id` names the agent it began, and whose `driver` may name the coding agent that
runs it. From there the agent belongs to whatever that
line started. Adding a project writes these three lines into the file, so a new project, an
empty folder included, starts an agent with nothing typed by hand. They are a default: a line
already there is kept, and any of them can be changed or deleted. A line finds its tools in the
packages the dashboard brings first, `agent-runner` and `agent-scheduler` among them, then in the project's installed ones;
nothing is downloaded to run a line. A project with no `start` line cannot start an agent from
the dashboard, and the dashboard says so. `npx @openagt/agent-scheduler@0.1 init`, run in the project, writes
the scheduler's `open` and `close` lines (they start it when the dashboard opens and stop it
when it closes), keeping any line already there. The file's keys are `open`, `close`, `start`, `resume` and `check`; any other key
is refused and the whole file ignored.

The launcher's **Post-merge cleanup** box, shown where the project has the
`post-merge-cleanup` command, puts `/post-merge-cleanup` in `THEN`: once the agent ends done
with a pull request, agent-runner starts a fresh agent on its branch with that command and the
first agent's id, and holds the pull request's merge until that one is done. Its default is
Settings → Agent → Post-merge cleanup, which the box writes too.

The launcher's chip above the box says which branch the agent starts from: the project's
main branch, fetched first, or **My local branch**, the branch the project's folder is on,
with its commits that are not pushed (edits that are not committed are not carried). The
local pick puts the branch's name in `BASE`, and is saved per project. The chip is shown only
when the `start` line mentions `$BASE`: a project whose line was written before the chip
existed gets it by adding `${BASE:+--base "$BASE"}` to the line.

The `check` line is what the launcher runs before a Start, with the picked coding agent in
`DRIVER`: it answers one JSON document with `problems` (a coding agent not installed or logged
out: said in red) and `warnings` (said in amber), each line naming its own fix. A project
with no `check` line shows nothing there.

A package's own settings are no hook. The scheduler's are the scheduler package's own part of
the dashboard: its Automations page holds a switch, a pace, a number of agents at once and a
publish pick per scheduled command, its Settings section holds how far past the quota boundary
it may start unattended work, and the handle on the usage bar is its stop line. That part reads
them with `agent-scheduler status` and saves them with `agent-scheduler offset`, `switch`,
`pace`, `agents` and `publish`.

The dashboard is a **projection of the agent's own files**. The agent's tool keeps the
agent's card (`<id>.json`) and diary (`<id>.jsonl`) under `.openagent/` in the agent's
checkout, and copies both onto the project's `agent-data` branch when the agent ends.
Everything the dashboard shows — live, and months later — it reads from those two files.

Steering goes back the same way, never over a channel:

- **What you say to a working agent** becomes a line in its `inbox.jsonl`, which the agent's
  tool reads when a turn ends.
- **What you say to an agent that has ended** — your words, or your answer to the question it
  stopped on — runs the project's `resume` hook, which continues that same agent.
- **Stop** is a signal to the process the agent's card names.

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

- `src/` — the CLI, the daemon, the hooks, the reading of a project's agents, and the server
  side of the dashboard. Node only.
- `dashboard/` — the browser app: a Vite SPA the daemon serves as static files,
  talking back over plain HTTP. See [its README](./dashboard/README.md).

## Status

Pre-release, published from the `0.x` line. There are no users to keep compatible,
so the code prefers being clean over being backward-compatible.
