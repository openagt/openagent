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
- Drain, then end. When a turn ends, every line already waiting in the inbox is sent as a
  further prompt of the same session, and the prompt returns when the inbox is empty; a
  line that comes later is for a new session resumed by its id. Picked over a session that
  waits for the next line: a process would idle while nothing happens, hold a runner's
  cap, and need a rule for when waiting is over. Nothing waits, and the question is a fact
  on the record, not a state in a process.

## The question
- The question is the fenced `await-choices` block OpenAgent's agents already end a
  turn with, now the driver's contract and parsed here alone; the words that teach an
  agent when to ask are the caller's. Picked over a format of the driver's own (a second
  parser and a second thing for agents to learn) and over no format (a question in free
  text has no options, so nobody-there cannot take the recommended one).

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

## The adapters
- Each driver is its own package, `@openagt/agent-driver-<name>`, on the contract `@openagt/agent-driver`
  keeps: the types, the shared process core, the inbox, the question, the log and the
  fake. A package is one of three kinds: a coding agent on this machine (`claude`,
  `codex`); a shared place that runs any coding agent's CLI (`github-actions`:
  dispatching, waiting and reading back are the same whichever agent runs, only the
  workflow step and the output reader differ); or one vendor's own cloud (later
  `claude-web`, `codex-web`, which share nothing). They live side by side under
  `packages/agent-driver/`. A caller installs only what it drives. Picked over one package
  holding every driver, over one package per agent holding every place, and over one `web`
  package for both vendors' clouds. Claude Code in a cloud session stays in the product
  until it has a seam apart from the browser bridge.
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
