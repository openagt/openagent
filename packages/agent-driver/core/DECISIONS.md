Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The package
- One package, `agent-driver` (#2394, decisions 15 and 20): the run engine, the run's record,
  this computer's host, and the coding agents' accounts with their rotation, each coding agent's
  adapter a package of its own. A tool with commands (`agent-runner`, `account-rotation`), not a
  skill: the engine runs one agent from start to end and nothing else, and when an agent starts
  is the scheduler's call or a person's. Picked over a runner beside the driver, which kept git
  out of the driver, and over the accounts in a package of their own beside the driver.
- The engine depends on `@openagt/hooks` for the session contract and on `agent-data` for the
  branch. A run's coding agent, its checkout and its pull request are the modules' of the
  distribution that starts the run, handed down to the run's process (#2394): each coding
  agent's adapter (`@openagt/agent-driver-claude-code`, `@openagt/agent-driver-codex`) fills
  `run.agent` with its driver and its readiness check, and the checkout and the pull request are
  steps. Picked over the runner depending on each adapter, where which coding agents a run could
  be on was the runner's to say. It runs only as a package of the OpenAgent that starts it: a
  run with no distribution handed down is refused (#2394, decision 4).
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

## The session
- One owner for a session, its log and its steering: the driver starts the coding agent,
  streams what it does, writes the log and reads the inbox, and says when the agent asked.
  Every other piece only passes paths or writes lines. Picked over the runner tailing the
  inbox and detecting the question itself (the session's protocol in two packages), and
  over a steering library imported from OpenAgent (a tool depending on the product). The
  caller is handed each line it takes, and says what the line changes for the prompts from
  it on (the sentence after them, when a message gives the run a new level).
- The inbox is read while a turn runs, and a message goes to the agent at once, which reads
  it between two of its steps, in the same turn; one sent for later waits for the turn's end.
  Picked over every message waiting for the turn's end, and over stopping the turn to start
  it again with the message: Claude Code's own chat hands it over at the next step, and
  both agents take it so (Claude Code's queued user line, Codex's `turn/steer`).
- Drain, then end. When a turn ends, every line already waiting in the inbox is sent as a
  further prompt of the same session, and the prompt returns when the inbox is empty; a
  line that comes later is for a new session resumed by its id. Picked over a session that
  waits for the next line: a process would idle while nothing happens, hold a runner's
  cap, and need a rule for when waiting is over. Nothing waits, and the question is a fact
  on the record, not a state in a process.

## The question
- The driver says that a turn ended on a question, and which: the one its coding agent's
  own tool asked, or the one the caller reads in the turn's last message. The block an
  agent with no such tool writes, and reading it, are the `ask` plugin's (#2394, decision
  18). Picked over the `await-choices` block as the driver's contract, parsed here: without
  `ask`, a run that asks just ends, and the person replies with a message.

## The log
- The log is written in the run record's shape, a card and a diary, as data the driver
  states and the `logs` skill reads, so a runner copies the two files onto its records
  unchanged and a dashboard reads them live with the reader it has for records. Picked
  over the driver's own event shape converted at the end (two shapes, a converter, and a
  live file nobody else reads).
- Every diary line says when it was written, in `at`. Picked over the dashboard noting when
  a line reached the browser, which gave a reloaded page one time for every line and a
  finished run none.
- A session that keeps a log names its diary in the agent's environment (`AGENT_DIARY`),
  so a command the agent runs can add a line of its own to the run's chat. Picked over
  the scheduler letting each package hook into a run's start.
- The agent's environment keeps what its own commands read (`AGENT_ID`, `AGENT_DIARY`,
  `OPENAGENT_DISTRIBUTION`, the account's token) and leaves out what only the run's process
  reads: the picks it was started with (`RUN_PICKS_ENV`). Picked over handing everything down,
  which gave a dashboard the agent started in its checkout the run's account for every run it
  started, and refused every run it continued.
- The card says how hard the model thought: the effort picked, else the one in force when
  the driver can tell (Codex says it, or its model list gives the model's default; Claude
  Code's settings may set one, and with none set it says nothing). Picked over the card
  naming only a picked effort.

## The run's record
- The run's record is agent-driver's: its card and its diary, and how they are read,
  written, patched and deleted (#2394, decision 15). The `logs` plugin reads it, for its
  command, its page and its card. Picked over the record in the logs plugin's package,
  which every core module that keeps or reads runs then imported.
- A run is two files on `agent-data`, the branch `@openagt/agent-data` names, never on a
  code branch: `agents/<who>/<id>.json`, the card, and `agents/<who>/<id>.jsonl`, the
  diary. Both are pushed. Keeping the diary on the machine that ran it was considered and
  dropped: a run's page on another machine, a continued run on another machine and a
  wiped laptop all read the diary from the branch, and a few megabytes a year is the
  price.
- The sessions with no project keep their runs together, in the personal folder's
  `sessions/` directory, in the shape a project's data has: one place for all of them, read
  from the sessions home and from any session's folder in it. Picked over a record kept in
  each session's own folder, which is not synced.
- `<who>` is the git email the writer's repository commits as, lowercased, unsafe
  characters replaced, `anonymous` when unusable. The folder groups the runs by person and
  protects nothing: ids never collide, and the same email authors the commits. A flat
  `agents/<id>.json` with the person inside the card was the alternative and was not
  taken: the grouping stays visible in a file listing.
- The card is small and the record's: `id`, `startedAt`, `endedAt`, `status`, `intent`,
  `driver`, `model`, `branch`, `pr`, `cost`. Everything else a writer records sits under
  one key of its own, `caller`, which the record stores and never reads. Owning the
  writer's whole record, renamed field by field, was rejected: a program's private
  fields would become a package's public API. Under semver these fields are the branch's
  public API: a change to them is a major.
- A fifth status, `waiting`: the run ended on a question the agent asked and waits for the
  answer to resume it. A status rather than a field on the card, because every reader
  filters on the status and a waiting run is neither running nor done.
- The diary is JSON lines. The record knows four kinds — `said`, `result`, `ended`,
  `cost` — and skips every other line a writer adds. A writer maps its own events onto
  the four; the record never learns them. A line may carry more fields than its kind
  needs; they pass through.
- A run in flight is its run record, written on `agent-data` before the agent is spawned
  with `status: running` and the tool's mark, and written again at the end over the same
  file. Picked over a separate marker file the sweep would have to match up with a record:
  one file for the run's whole life, and every machine counts the same records.
- A running record from a machine that never comes back stays. Only the machine that wrote
  it, or a person, changes it. Picked over ageing it out after a fixed time, which could
  end a long run that is still working.

## Flow: what the writer records
- A run is recorded once, when it is over, as one commit carrying both files. Late
  facts are patched onto the card afterwards, one commit per patch: the branch the work is
  on, the pull request, and that the work landed, which drops the branch and keeps its last
  commit and the commit the work began at under the writer's key. A run is deleted as one commit, both
  files. A run a dead writer left marked running is recorded again by the next writer that
  notices, ended, where it already sits. Nothing else on a card changes after it lands.
- The writer's persistent checkout is `.branches/agent-data`, and its writes go through
  that checkout's serialized cycle, the same as the other skills'.

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

## Profiles and accounts
- A run is on a profile (#2394): a name and a saved set of run options, kept with the person
  through the store (the catalog's `profiles.saved`), named in the run's environment by whoever
  started it, Default when nobody did. Its options are the run's where the session picked
  none: its accounts, the plugins it goes without, and which of the project's own skills stay
  in its checkout. Its other skills are its modules' (above). The record keeps the profile, and each leg of the run, a resume too, is on it as it stands then.
  Picked over the dashboard resolving a profile's options per run: a scheduler's runs name no
  profile and are on Default, so its edits reach them with nothing restarted.
- The account a run works as at the git host is the session's: the one whoever started the run
  picked for it, in the run's environment, else its profile's, else the computer's. The git host's
  module works as it at the run's first step (`RunOrder.ACCOUNTS`, #2394): the account's
  environment is the run's (`ctx.env`), handed to the agent and this process's own until the leg
  ends, so the run's marker, its checkout's fetch and its record go as that account too. The
  record keeps the login it worked as, and a resumed run goes on as it, never as whatever the
  computer's pick is by then. An account this computer cannot use stops the run before it
  starts, naming it (the host's check); one that goes by then fails the run at that step. A
  profile's account applies where the project has a git host, and in a session with no project:
  in a project on another host the run goes as no account rather than refused. A session with no
  project has its account too, at the first of the distribution's git hosts that gives it: its
  folder is on no host, and it reaches one all the same (a clone, a new repository, the
  person's pull requests). With no account named and none there it goes on as no account, since
  it may need none. Picked over no account for such a session, which left its work on a git
  host to whatever login the computer happened to have. On
  Claude and Codex a profile's accounts apply where this computer has them, and none of them here
  is every account of the computer's: a profile made on another computer runs here without them.
  Picked over accounts named per project, which were kept on one computer for a repository
  that is the same everywhere: whose account a session uses is a pick made for that session.
- A session's picks are the run's, in its environment with its profile, each over its profile's
  (#2394, decision 37): the enabled plugins it goes without, none of whose skills or steps it
  gets, and which of the project's own skills stay in its checkout. The record keeps the picks
  and a resumed run goes on with them.

## The adapters
- Each driver is its own package, `@openagt/agent-driver-<name>`, a module of the distribution
  that fills `run.agent`, the contract `hooks` declares (#2394), built with what `@openagt/agent-driver` keeps: the shared
  process core, the inbox, the question, the log and the fake. A driver is a coding agent on this machine (`claude`, `codex`), and they live side
  by side under `packages/agent-driver/`. A place elsewhere that runs a run is a host of
  it (`run.host`), a plugin of its own: a GitHub Actions runner (`host-github-actions`), or
  one vendor's own cloud (`host-claude-web`; a `codex-web` would share nothing with it)
  (#2394). A caller installs only what it drives. Picked over one package holding every
  driver, over one package per agent holding every place, over one `web` package for both
  vendors' clouds, and over a place being a driver beside the coding agents
  (`agent-driver-github-actions`).
- Every adapter takes the same three parts of the person's own setup, `memory`,
  `connectors` and `skills`, and turns each off with its own coding agent's switches. A
  part it cannot keep out is a warning in its readiness check, never a silent "off".
  Picked over the runner knowing each coding agent's switches (every new adapter would
  change the runner).
- Codex keeps `skills` out by running from a Codex home of its own: one per machine, kept
  (Codex saves conversations there, and a resume needs them), holding a link to the
  person's login, made on the first run. Picked over leaving Codex's personal files in
  with a warning. Skills in `~/.agents/skills` have no switch: a warning, not a changed
  home directory, which would also move git's and gh's credentials.
- One event says a subagent a coding agent started inside its own session — its name, its
  role, its model and whether it is still working — and each adapter fills as much of it
  as its own CLI says, leaving out what it does not. Picked over an event shape per coding
  agent, which a reader would have to learn twice, and over leaving such a call as the
  plain tool row it was: a row with no name on it, and on Codex one that never resolved.

## Accounts
- Which of a person's accounts takes a turn is the `agent-driver` module's rotation (#2394,
  decision 15), handed to a driver when it starts; what an added account's login is and how a
  turn runs on it is the driver's. What else only the agent knows of its accounts, it gives with
  itself (`RunAgent.accounts`, #2394: "Claude Code: … a token per turn, `setup-token` sign-in,
  usage"; "Codex: … a Codex home per account, sign-in"): its own login and who it is, how a new
  one signs in, its logout, how full an account is now, and what it keeps of an added account
  beside the list.
- Claude's `/usage` is read once for everyone who asks at the same moment: in a process, whoever
  asks while a read of the same login goes on is answered by it; across a computer's processes, one
  reads at a time, holding a lock beside the reading kept for everyone, and whoever waited for it
  is answered what it read (a good reading, whoever asks within half a minute of it too; a failure,
  only whoever waited for it). Each read starts the whole CLI with its MCP servers, and Claude Code
  refuses `/usage` asked too often: 17 reads at once took a computer people share to a load of
  171. Picked over each caller reading its own.
- An agent's package declares how its CLI is installed and logged in, each one command a
  press runs with no terminal and no admin (Claude Code: its own `install.sh` into
  `~/.local/bin`, and `claude auth login` in this computer's browser; Codex: its own
  `install.sh` into `~/.local/bin`, and `codex login`). A dashboard shows the
  command under the button and runs only what the package declared. Picked over a line that
  tells the person what to type in a terminal.
- A person may give an agent several accounts of its own, kept in a list in their order: a
  run is on the first one free, and one that hits its limit hands the same conversation to
  the next free one, which is told to go on where it stopped. Only the runs an agent's
  driver starts change account: the account's login reaches that turn alone, and the
  person's own login, the one their terminal uses, is never touched. How it reaches the turn
  is the agent's own (Claude Code reads a login from the turn's environment; Codex keeps one
  in its home folder, so an added account has a folder of its own that links to the
  conversations of the person's home); the list, its order and the hand-over are one piece
  every agent shares. Picked over
  switching the whole computer's login when a limit is hit (every session moves, the
  person's terminal included, and a Mac keeps its login where such a switch cannot reach),
  and over a pooled account that people lend to an agent through a link (later, maybe).
- An account hands over only to an account of the same agent: a conversation is kept in
  each agent's own format, so moving it to another agent would lose it.
- A driver holds no rotation: it is handed one (`AccountRotation` in `agent-driver`) by whoever
  starts it, and a driver handed none runs on whatever login its agent has. What only an agent
  knows of its logins, its adapter gives with the agent (`RunAgent.accounts`, #2394), and
  `agent-driver` depends on no adapter. Picked over the drivers calling the rotation, a circle
  of packages; over the rotation depending on the drivers for their logins, which kept it out of
  `agent-driver`, the package the drivers build on; and over the switching staying in the
  drivers, with only the list moved out.
- No run gets the skill (#2394): the accounts and their rotation are agent-driver's, and runs
  switch accounts without it, the engine using the rotation itself. The skill only lets an
  agent add or remove an account when the person asks. Picked over every run getting it, one
  more description in every agent's context for something a person seldom asks.

## The accounts card and command
- An Accounts card built only on the package: it reads the accounts through the package's
  server part (#2394, decision 8), which answers what the command's `list`, `usage` and
  `adding` answer, and changes them through the command, so it shows what the command says.
  Picked over moving the whole Settings page first; that it overlaps the Usage card is
  accepted, and Customize hides either.
- The person's own login can be logged out from the card and Settings, their terminal with it.
  Picked over never offering it: an account on the list cannot be added a second time, so there
  has to be a way to take any row off.
- The card says the same numbers as the Permissions page, and the package reads them itself, what
  the `usage` command answers. Picked over the card showing only what the last run saved, which on one account
  is nothing, and over OpenAgent handing the card its own reading, which a skill's own page does
  not have.
- The card is "Coding agent accounts", and what it does at an account's limit is said behind an ⓘ
  beside its title, only while an agent has two accounts or more: with one each, nothing
  rotates. Rotation is the runner's for every run: the skill only teaches an agent to change
  the accounts when asked.
- One way to add an account, the same for an agent, a card and Settings, on a computer with a
  browser or with none: the sign-in runs in a process of its own, and commands start it, read it
  and hand it the code. Picked over the sign-in staying in OpenAgent's process, where only
  Settings could reach it.
- The card adds an account from "Add" at its title, a menu of the coding agents, and the sign-in
  is a dialog: whose account it is, then the sign-in followed there until the account is in the
  list, which closes it; closing it stops the sign-in. A card with no account at all also says so
  in its body, with a press for each agent. Picked over the sign-in unfolding inside the card
  under a row of agent names that read as a label.
- The dialog that adds an account is also a press of its own, one per agent (`agent.connect`),
  which the Overview's "Connect a coding agent" step draws: one sign-in to learn, wherever an
  account is asked for. Its field opens with the person's own first name, unless an account of
  that agent already goes by it, so the first account is one press and a yes in the browser.
  A press that stands alone opens no dialog on a sign-in found under way; the card does, so one
  sign-in never opens two on a page. Picked (Suleiman, 2026-11-24) over an empty field, and over
  the step logging the computer's own CLI in.
