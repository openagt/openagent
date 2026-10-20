Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The tool
- A tool, a package with a command line, like `agent-driver`; not a skill. It runs one
  agent from start to end and nothing else: when an agent starts is the scheduler's call,
  a person's, or another run's agent's.
- Standalone, beside `agent-driver`, not inside it. `agent-driver` depends on nothing; the
  runner needs git for its checkouts and its records, and inside the driver every user of
  the driver would get git and the skills with it. Either way was open; this one for now.
- The runner depends on `@openagt/agent-driver` for the session contract, on each coding
  agent's adapter (`@openagt/agent-driver-claude`, `@openagt/agent-driver-codex`) for
  its driver and its readiness check, on the branches package for the checkout and the
  reclaim, on the logs package for the records, and on `agent-data` for the branch. It
  never depends on OpenAgent; OpenAgent brings it, as one of its packages.
- The runner reads no schedule: a run is the prompt it is given. It names no skill: the
  skills every run gets are handed to it by the package that started OpenAgent
  (`@openagt/start`), and a git host's among them only where the project is on that host.
  Their texts are linked into each agent's checkout, hidden from git like the branches
  skill, each with its command when it has one, so an agent in any project can read
  earlier runs, ask the person a question and open a pull request with nothing committed.
  A project's own copy of one is left alone. Picked over every skill coming from the
  project's own committed files, where a person who cannot change the default branch got
  agents that could not ask a question; and over the runner naming them itself, where the
  runner alone was OpenAgent's defaults.

## The record
- A run in flight is its run record, written on `agent-data` before the agent is spawned
  with `status: running` and the tool's mark, and written again at the end over the same
  file. Picked over a separate marker file the sweep would have to match up with a record:
  one file for the run's whole life, and every machine counts the same records.
- A running record from a machine that never comes back stays. Only the machine that wrote
  it, or a person, changes it. Picked over ageing it out after a fixed time, which could
  end a long run that is still working.

## The run
- One process per run, one-shot: `agent-runner run <prompt>` needs no scheduler, and the
  scheduler's tick spawns the same thing with the id and the marker already made. Picked
  over the scheduler holding pids: nothing to lose on a restart.
- `run --detach` writes the marker and spawns the run's process the way a scheduler's tick does,
  answering the id at once: the line a dashboard's start hook runs. Picked over the
  dashboard spawning the run's process itself, which would name the tool and hold a pid.
- The run is a checkout from the branches package, a session from `@openagt/agent-driver`, the
  prompt once, and the agent's own loop to the end. No system prompt, no gates, no
  steering: the command's skill file is the whole instruction. Picked over carrying
  OpenAgent's run child over: its flow is the dashboard's, not a scheduled run's.
- The agent publishes its own work, when asked to, through the skills in its checkout; the
  run publishes nothing, and reads the pull request back off the branch for the record,
  through the command the project's git host package declares, never through a git host's
  own client. Picked over the run opening the
  request from the branch's commits, and over the agent leaving a title and body in a file.
- `git-host <command>` runs a command of the project's git host package and prints what it
  printed, so a skill's check reads pull requests with no git host named. Picked over a
  skill naming the GitHub skill's command.
- How far a run takes its work is one sentence after its prompt: commit it, and from there
  push the branch, open its pull request, or set it to merge once its checks pass
  (`run --publish <commit|branch|pr|merge>`). Every level starts with the commit. With no
  level the prompt goes as written, and the agent commits and publishes only what the prompt
  itself asks. The record keeps the level, so a resumed run says it again. A message, or a
  resume, can give the run another level from there on, or take it away (`nothing`), and the
  record names the new one: a person who liked the work has it published by saying so. A
  level given part way also ends the run's follow-up, which was the merge's: the person has
  said how far the run goes. The sentence follows
  every message the agent is sent, a queued one too, and the diary keeps it apart from the
  message, so a reader shows a person's words as the person wrote them. Picked over gluing
  it into the prompt, where it read as the person's own words and a queued message got none. Picked over the
  skills naming a level, where whoever started the run had no say, and over the tool
  publishing after the agent, which would be the tool doing the agent's work.
- A run with a follow-up tells its agent, in a line after the prompt, to publish its work
  without arming the pull request's merge, and the tool merges it through the git host
  once the follow-up ends done. Picked over a hold on the checkout that the agent's publish honoured, which put the
  git host inside the branches package.
- The live record is agent-driver's log, written in the run record's shape, and the run
  copies the two files onto the branch unchanged. Picked over the tool's own live log in
  the dashboard's shape, converted at the end: one shape, one file, no temporary label.
- A run's live directory is hidden from git in the run's checkout alone, by a `.gitignore`
  of `*` inside it, one already there kept. Picked over a rule in the repository's shared
  exclude file, which every checkout reads, the project's own included.
- A run ends `waiting` when its last turn asked and nothing waited in the inbox: recorded
  so, its checkout kept for the answer. The answer, or a text, resumes the same run: the
  same id, the same record, the same branch, the session resumed by the id the record
  carries, the diary continued. Picked over a new run per answer (two records for one
  piece of work, and the first left waiting for ever) and over a process that waits for
  the answer (nothing waits; state in files).
- A run whose coding agent no longer has its conversation goes on as the same run, in a
  fresh conversation: its record says where the fresh one starts, and its agent is told to
  read the run's record first, and its pull request's whole thread. Picked over a new run
  that reads the old one (two rows for one piece of work), and over the agent going on
  without knowing it forgot.
- A run is on Claude Code, or on Codex with `run --driver codex`. The person picks.
- Either coding agent does the same: it works and, when asked to publish, pushes its
  branch and opens its pull request itself. For that, neither may be restricted: Claude Code runs with permissions
  bypassed, Codex with full access. Codex's default lets it write only in its checkout, so
  it could not push. Picked over a restricted Codex with agent-runner pushing for it: a
  run would then end in two different ways, and agent-runner would do the agent's work.
- A resumed run is on the coding agent its record names.
- A run's coding agent, Claude Code or Codex, starts with the person's own setup, as when
  started by hand: their memory, their account's connectors, apps and plugins, their own
  instructions, skills and settings files. The coding agent stays a black box, and a run
  holds no surprise for the person. Each part is left out on one machine with its own line
  under `personal:` in `.agent-runner/config.yml`, the same line for either coding agent,
  so a run does the same job on every machine. Picked over leaving the setup out by
  default, and over one line for the whole setup.
- A run with no model named starts on the coding agent's own default. Picked over the
  runner reading the scheduler's model: the runner reads no scheduler file, and the
  launcher already says "the CLI's own default".
- A run can be started for another run: `run --parent <id>` writes the parent on the run's
  record. The runner still starts nothing on its own: the parent's agent runs the command.
  Picked over a separate file that maps parents to children: one record per run already
  says everything about it.
- When a run with a parent ends, the runner sends the parent one line: which run, how it
  ended, its last words. The line reaches the parent the way a person's message does: into
  its inbox while it runs, as a resume once it has ended. Picked over the parent waiting
  inside a command for its child (a process that waits, and a coding agent's command cannot
  wait an hour), and over the parent polling the records.
- A run starts from the branch it is told, `run --base <ref>`, written on its record. With
  none, origin's default branch, as before. Picked over a run that always starts from the
  default branch: a run started for another run needs what that run has built so far.
  The `start` line passes it on too (`BASE`), so a person can start a run from their own
  local branch. The branch's name is on the record beside the host as well, so a reader
  that does not know the runner's mark can say where the run started.
- A run that makes its own branch records the commit the branch was made at: where its
  own work begins. Picked over the base's name: a branch is renamed, moves on, and is
  deleted once merged. Picked over recording it only for a run started with `--base`: once
  a run's work is merged, the default branch holds all of it, and nothing else says what
  the run changed. A run given a branch that exists records none: that branch's work began
  with another run.
- The run records itself and reclaims its own checkout when the agent stops, pushing
  nothing: a clean checkout goes, its branch stays on this machine; the sweep on the tick
  catches what a dead process left, on this machine only.
- A run stops on SIGINT or SIGTERM to its process: the agent's process tree is ended, the
  run is recorded `stopped`, the checkout reclaimed. The pid is in the live log, so a
  dashboard's Stop is that signal. Picked over the run reading the dashboard's control file
  (the tool would read a file of OpenAgent's shape), and over dying at once (the agent's
  processes would outlive the run, and the sweep would record it `failed`).

## When a run needs a person
- When a run ends waiting on a question, or ends done with a pull request it did not have,
  the runner runs a line the person wrote: `ended:` in `.agent-runner/config.yml`, with one
  line for a person in `MESSAGE`. The runner names no service; what the line does is the
  person's. Picked over the agent posting (it can forget, and a dead run posts nothing) and
  over the dashboard watching the runs (nothing posts while no dashboard is open).
- The line is per machine, out of git, beside the run locks. Picked over a committed file:
  where to post is set per machine, and a teammate's machine should not post to your
  channel.
- A question and a new pull request only. A run that fails, is stopped, or ends done with
  nothing to review runs no line. Picked over a line on every end: the line is for what
  waits on a person.

## The command line
- Every command prints one JSON document on stdout, one line for a person on stderr, and
  exits 0 for a result, 1 for a refusal or a failure, 2 for a command line that cannot be
  read: the skills' contract, so a person and a dashboard read it the same way.
- `run --detach --resume <id>` continues an ended run in its own process and answers its
  id at once: the line a dashboard's resume hook runs, the sibling of `run --detach`. A
  run this project has no record of is refused while someone is still listening; anything
  after that is the resumed run's own record. Picked over the hook running the resume in
  the foreground, which would hold the dashboard's request open for the whole turn.
- `agent-runner cleanup` removes what the tool left in a project, and is what a dashboard
  runs when a project is removed with its files. Picked over a dashboard deleting
  `.agent-runner` itself.
