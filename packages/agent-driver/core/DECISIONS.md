Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

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

## Flow: what the writer records
- A run is recorded once, when it is over, as one commit carrying both files. Late
  facts are patched onto the card afterwards, one commit per patch: the branch the work is
  on, the pull request, and that the work landed, which drops the branch and keeps its last
  commit and the commit the work began at under the writer's key. A run is deleted as one commit, both
  files. A run a dead writer left marked running is recorded again by the next writer that
  notices, ended, where it already sits. Nothing else on a card changes after it lands.
- The writer's persistent checkout is `.branches/agent-data`, and its writes go through
  that checkout's serialized cycle, the same as the other skills'.

## The adapters
- Each driver is its own package, `@openagt/agent-driver-<name>`, on the contract `hooks`
  declares (`run.agent`, #2394), built with what `@openagt/agent-driver` keeps: the shared
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
  decision 15), today in `@openagt/skill-account-rotation`, handed to a driver when it starts;
  what an added account's login is and how a turn runs on it is the driver's.
- An agent's package declares how its CLI is installed and logged in, each one command a
  press runs with no terminal and no admin (Claude Code: its own `install.sh` into
  `~/.local/bin`, and `claude auth login` in this computer's browser; Codex: its own
  `install.sh` into `~/.local/bin`, and `codex login`). A dashboard shows the
  command under the button and runs only what the package declared. Picked over a line that
  tells the person what to type in a terminal.
