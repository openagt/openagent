Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The tool
- A tool, a package with a command line, like `agent-driver`; not a skill. It runs one
  agent from start to end and nothing else: when an agent starts is the scheduler's call or
  a person's.
- The run engine is the `agent-driver` module (#2394, decision 15): the engine, the run's
  record, this computer's host, and the coding-agent accounts with their rotation, each
  coding agent's adapter a package of its own. It lives in this package until the packages
  are merged. Picked over a runner beside the driver, which kept git out of the driver.
- The runner depends on `@openagt/agent-driver` for the session contract and the
  records, on each coding agent's adapter (`@openagt/agent-driver-claude-code`,
  `@openagt/agent-driver-codex`) for its driver and its readiness check, and on
  `agent-data` for the branch. A run's checkout and its pull request are steps of the
  modules of the distribution that starts the run, handed down to the run's process
  (`@openagt/hooks`, #2394). It runs only as a package of the OpenAgent that starts it:
  a run with no distribution handed down is refused (#2394, decision 4).
- The runner reads no schedule: a run is the prompt it is given. It names no skill: a run's
  skills are its modules' (`run.skills`, #2394), the modules of the distribution that started
  OpenAgent (`@openagt/dashboard`): every core module's, a git host's only where the project is
  on that host, and those of the plugins on in the project. Their texts are linked into each
  agent's checkout, hidden from git like the branches skill, each with its command when it has
  one, so an agent in any project can ask the person a question and open a pull request with
  nothing committed.
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
- This computer's host (`run.host`, the agent-driver module's) starts a run as `run --detach`
  does: it writes the marker and spawns the run's process the way a scheduler's tick does,
  answering the id at once. Picked over the dashboard spawning the run's process itself,
  which would name the tool and hold a pid, and over a start line in the project's
  `.openagent/hooks.yml` (#2394).
- The run is a checkout from the branches package, a session from `@openagt/agent-driver`, the
  prompt once, and the agent's own loop to the end. No system prompt, no gates, no
  steering: the command's skill file is the whole instruction. Picked over carrying
  OpenAgent's run child over: its flow is the dashboard's, not a scheduled run's.
- A run in the sessions home has no project: it works in a folder of its own there, with the
  same skills linked in and no git, and the folder stays when the run ends, holding what the
  agent made. The home is beside the personal folder, not in it: the personal folder is
  committed whole and synced to the person's repository. Picked over the folder in the
  personal folder, where a session's files would be pushed with the records.
- The agent publishes its own work, when asked to, through the skills in its checkout; the
  run publishes nothing, and the git host's module reads the pull request back off the
  branch for the record (github's step, #2394). Picked over the run opening the request
  from the branch's commits, over the agent leaving a title and body in a file, and over
  the command a project's own git host package declares: the distribution decides the git
  host.
- `git-host <command>` runs a command of the project's git host package and prints what it
  printed, so a skill's check reads pull requests with no git host named. Picked over a
  skill naming the GitHub skill's command.
- How far a run takes its work is one sentence after its prompt: commit it, and from there
  push the branch, open its pull request, or set it to merge once its checks pass
  (`run --publish <commit|branch|pr|merge>`). Every level starts with the commit. With no
  level the prompt goes as written, and the agent commits and publishes only what the prompt
  itself asks. The record keeps the level, so a resumed run says it again. A message, or a
  resume, can give the run another level from there on, or take it away (`nothing`), and the
  record names the new one: a person who liked the work has it published by saying so. The
  sentence follows every message the agent is sent, a queued one too, and the diary keeps it apart from the
  message, so a reader shows a person's words as the person wrote them. Picked over gluing
  it into the prompt, where it read as the person's own words and a queued message got none. Picked over the
  skills naming a level, where whoever started the run had no say, and over the tool
  publishing after the agent, which would be the tool doing the agent's work.
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
- A run is never started for another run: a coding agent splits a job with its own
  subagents (Claude Code's `Agent` tool, Codex's), inside its session. Picked over runs
  started for a run (`run --parent`), each told to its parent when it ended: the coding
  agents already do that themselves, and a part needs no checkout, branch or record of its
  own (#2394).
- A run starts from the branch it is told, `run --base <ref>`, written on its record. With
  none, origin's default branch, as before. Picked over a run that always starts from the
  default branch: a person can start a run from their own local branch, or from another of
  the branches on origin (`git-branches`' run option `base`, #2394). The second is told by
  the full name of origin's copy, and fetched first; a fetch that fails fails the run.
  Picked over the short `origin/x`, which a local branch of that name would take over. The
  branch's name is on the record beside the host as
  well, plain (`x`, whichever it was), so a reader that does not know the runner's mark can
  say where the run started.
- A run that makes its own branch records the commit the branch was made at: where its
  own work begins. Picked over the base's name: a branch is renamed, moves on, and is
  deleted once merged. Picked over recording it only for a run started with `--base`: once
  a run's work is merged, the default branch holds all of it, and nothing else says what
  the run changed. A run given a branch that exists records none: that branch's work began
  with another run.
- The run records itself and reclaims its own checkout when the agent stops, pushing
  nothing: a clean checkout goes, its branch stays on this machine; the sweep on the tick
  catches what a dead process left, on this machine only.
- A run stops on SIGINT or SIGTERM to its process: the agent is asked to end its turn where
  it is, as Esc does in Claude Code, the run is recorded `stopped`, the checkout reclaimed,
  and a message continues it. A second signal ends the agent's process tree at once. The
  pid is in the live log, so a dashboard's Stop is that signal. Picked over ending the
  agent's process tree at once (its conversation could be cut halfway through a write), over
  the run reading the dashboard's control file (the tool would read a file of OpenAgent's
  shape), and over dying at once (the agent's processes would outlive the run, and the
  sweep would record it `failed`).

## The command line
- Every command prints one JSON document on stdout, one line for a person on stderr, and
  exits 0 for a result, 1 for a refusal or a failure, 2 for a command line that cannot be
  read: the skills' contract, so a person and a dashboard read it the same way.
- `run --detach --resume <id>` continues an ended run in its own process and answers its
  id at once, the sibling of `run --detach`, as this computer's host resumes a run. A run
  this project has no record of is refused while someone is still listening; anything
  after that is the resumed run's own record. Picked over resuming in the foreground,
  which would hold the person's request open for the whole turn.
- `agent-runner cleanup` removes what the tool left in a project, and is what a dashboard
  runs when a project is removed with its files. Picked over a dashboard deleting
  `.agent-runner` itself.

## Presets and accounts
- A run is on a preset (#2394): a name and a saved set of run options, kept with the person
  through the store (the catalog's `presets.saved`), named in the run's environment by whoever
  started it, Default when nobody did. Its options are the run's where the session picked
  none: its accounts, the plugins it goes without, and which of the project's own skills stay
  in its checkout. Its other skills are its modules' (above). The record keeps the preset, and each leg of the run, a resume too, is on it as it stands then.
  Picked over the dashboard resolving a preset's options per run: a scheduler's runs name no
  preset and are on Default, so its edits reach them with nothing restarted.
- The account a run works as at the git host is the session's: the one whoever started the run
  picked for it, in the run's environment, else its preset's, else the computer's. The git host's
  module works as it at the run's first step (`RunOrder.ACCOUNTS`, #2394): the account's
  environment is the run's (`ctx.env`), handed to the agent and this process's own until the leg
  ends, so the run's marker, its checkout's fetch and its record go as that account too. The
  record keeps the login it worked as, and a resumed run goes on as it, never as whatever the
  computer's pick is by then. An account this computer cannot use stops the run before it
  starts, naming it (the host's check); one that goes by then fails the run at that step. A
  preset's account applies only where the project has a git host: in a session with no project,
  or a project on another host, the run goes as no account rather than refused. On
  Claude and Codex a preset's accounts apply where this computer has them, and none of them here
  is every account of the computer's: a preset made on another computer runs here without them.
  Picked over accounts named per project, which were kept on one computer for a repository
  that is the same everywhere: whose account a session uses is a pick made for that session.
- A session's picks are the run's, in its environment with its preset, each over its preset's
  (#2394, decision 37): the enabled plugins it goes without, none of whose skills or steps it
  gets, and which of the project's own skills stay in its checkout. The record keeps the picks
  and a resumed run goes on with them.
