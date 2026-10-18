Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The tool
- A tool, a package with a command line, like `agent-driver`; not a skill. It owns one
  small process with a clock, and nothing else runs agents on a schedule. Picked over a
  skill the agent would read, and over a job inside OpenAgent's daemon: the daemon
  becomes a dashboard, a projection of files, and this is the thing that decides when
  agents start.
- Two tools: `agent-runner` runs one agent from start to end, `agent-scheduler` keeps the
  timetable and has `agent-runner` run what is due. Picked over one tool doing both: its
  name said schedule, yet it ran every agent, the Start box's too.
- The scheduler uses `@openagt/agent-runner` as a library, not its command line: the tick writes
  the marker, counts the cap again, and only then spawns the run, so it needs the run's id
  before the run exists.
- Standalone, beside `agent-driver`, not inside it. `agent-driver` depends on nothing; the
  runner and the scheduler need git for the checkouts and the records, and inside the
  driver every user of the driver would get git and the skills with it. Either way was
  open; this one for now.
- The scheduler depends on `@openagt/agent-runner` for the runs, the records and the
  sweep, on `@openagt/agent-driver` for the quota reading, on the branches package for
  the project root, on the logs package to count the records, and on `agent-data` for
  the branch. It never depends on OpenAgent; OpenAgent brings it, as one of its
  packages. Its dashboard part is the exception: it is drawn with the dashboard's module
  contract, and the tool itself runs without it.
- The tool names no skill and no command. What runs comes from the project's skills: a
  skill says in its own file that it can be scheduled, and a skill that is not in the
  project has no scheduled command. Picked over the tool linking a command's skill into the
  checkout from a package: a project tracks its skills, and the tool reads the project.
- One scheduler per project, since the schedule comes from the project's skills and the
  state sits in the project. Picked over one per machine reading a registry of projects:
  nothing machine-wide is left for it to hold.

## The schedule and the state
- The schedule is the project's skills, and the automations a person keeps on their own
  machine. A skill brings its scheduled command in the front
  matter of its `SKILL.md`, under `schedule`: its check, its pace, how many agents may run
  it at once, and one plain line saying what the check waits for. Picked over
  `agent-schedule.md`, a tracked file at the repository root that a person wrote, one line
  per command: a line could name a skill the project did not have, the check lived far from
  the skill it belongs to, and a project with no such file had no scheduled command
  whatever its skills. The check is a shell command run at the repository root; due means
  it exits 0 and prints a JSON value that is not empty. Picked over the tool reading the
  branch head (every commit was a start, most of them empty), over the tool reading the
  queue (the tool would know a skill), and over a bare clock (empty runs). A `schedule` the
  tool cannot read is skipped and named, never guessed.
- A skill's check may name the commands of other skills (the queue's, the tickets'),
  though the words a command skill gives the agent name none. The scheduler runs the check;
  the agent is never given the shell line, only what it printed. Picked over keeping the
  checks in a file of the project, away from the skill they belong to.
- A run its check started is handed what the check printed, after its command and apart
  from it on the run's record. The words before it say the output is why the run started
  and that the command says what the work is, because a check may print only a sign that
  there is work. Picked over the agent getting the command's name alone: the check had
  already found the new thing, and the agent had to look for it again.
- A check is given the time its command last started, on any machine, as `$LAST_RUN`, or
  the time a person switched the command on on this machine when that is later. A check
  that asks what is new since then goes quiet once a run was started for it. Picked over
  the scheduler remembering what it had already handed over, which it would have to store
  where every machine shares it.
- A run that fails is not started again by itself: the time a check is given moves with
  every start, a failed one too. The command's row says that its last run failed, until a
  later run of the command starts, so a person sees it and can start the work by hand.
  Picked over the time moving only after a run that ended well: the same failure would
  start an agent again each time the pace allows, and spend by itself.
- Every scheduled command starts switched off, on every machine, and runs only where a
  person switched it on. Picked over a command that runs unless a person switched it off: a
  skill that arrives in a project would start agents by itself.
- The schedule is read from both folders a coding agent reads skills from, `.claude/skills`
  first. A coding agent runs a command only when the command's skill is in that agent's own
  folder, `.claude/skills` for Claude Code and `.agents/skills` for Codex: sent to the other
  agent, the command finds no skill. A command whose skill is only in one folder runs on
  that folder's agent unless its skill or a person names the other, and a row set to an
  agent that cannot read its skill is listed, not started, and says so. Picked over reading `.claude/skills` alone, where such a skill
  would have no row and nothing would say why.
- A row has its own coding agent and its own model, picked like its pace: its skill may
  name the ones it is made for (`agent`, `model`), and each person may pick their own for
  their machine, in the state file. With no pick a run is on Claude Code, on the
  scheduler's model. A model is one agent's: a person's model is kept with the agent it
  was picked for and holds only while the row runs on that agent, and a skill's model is a
  model of the agent the skill names, of Claude Code when it names none.
  Picked over one model and one agent for every row of a project, where a simple copying
  job that may run every 15 minutes cost as much a turn as real coding.
- Only Claude's quota can be read. A run on Codex starts without the quota question, and
  the page says so; its cost is not recorded either, since Codex prices no turn. Picked
  over holding Codex rows back until a reading exists: nothing would start them.
- How far a scheduled command's runs publish is each person's pick on their own machine, in
  the state file like the switch; the scheduler's own Automations page shows the pick and
  changes it. Until a person picks, a run commits its work and pushes nothing. Picked over
  a level written beside the command for the whole team, which a person could only
  override: nothing leaves a machine before its own person said so. The page says a level
  as what a run may do ("May commit, pushes nothing"), not as what it will do: a run that
  has nothing to commit commits nothing.
- A skill paces its scheduled command two ways, alone or together: `when` says there is
  work (the check's output), `every` says how often at most (the least time since the
  command's last recorded start, read off the run records on the branch, so every machine
  agrees and nothing new is stored). A routine whose run changes nothing cannot be paced by
  a check alone: it would start every minute. Picked over a rotation of the routines in a
  fixed order behind an empty queue (one command then depends on another, and idle it
  started an agent every 30 minutes). Order is what the numbers say.
- The skill's pace is where a command starts. Each person may set another for their own
  machine, in the state file like the switch: an interval in minutes, hours, days, weeks or
  months, or whenever there is work. Picked over the pace being the skill's alone, where
  slowing a command on one machine meant editing a tracked file.
- A pace in days, weeks or months may name a time of day, in the machine's own time, like a
  calendar event: the command is due from that time on, on a day at least that many days
  after the day it last started. A time that was missed runs once, as soon as the scheduler
  looks. This takes back the earlier pick against a clock time (machine-local, and two
  machines fire twice): the pace counts from the last start on any machine, so two machines
  never run the work twice.
- How many agents of one command work at once is each person's too, in the state file like
  the pace. The skill's number is where it starts, 1 when the skill gives none. A machine
  starts another agent only while fewer than its person's number are working, counting the
  agents of every machine that shares the repository. Picked over the number being the
  skill's alone, where letting two agents work on one machine meant editing a tracked file.
- A person may save a prompt of their own from the Automations page, and chooses who gets
  it. Shared, it becomes a command skill of the project, a file the person commits, with a
  row like any skill's. Kept on their machine, it is a file in the tool's own folder,
  hidden from git: nobody else gets the row, nothing is to commit, and it can start at
  once. Either way the row starts switched off. Picked over one kind alone: a shared one
  needs a commit and reaches everyone, a private one neither.
- A row a person made this way can be edited and removed from the Automations page: its
  prompt, its pace and its check. Its name stays, since a run is counted by the name, so an
  edited row keeps its past runs, and another name is a new row. Editing or removing a
  shared one changes its file, which the person commits. The rows the project's skills
  bring are not edited or removed from the page. Picked over a page that edits any
  scheduled skill: a skill's file is its author's. A save from the page is refused when
  the row's file was changed since the page read it: it writes over no change made by
  hand.
- A row has one place for its pace on the Automations page, whoever made it: its Edit
  panel, the same for every row. For a row a person made, the pace picked there is the
  automation's own, saved into its file with its prompt and its check, and their machine
  keeps only a time of day. For a row a skill brings, it is that machine's pick, and the
  skill's pace is one of the choices. Picked over two places, the automation's pace in one
  form and the machine's pick in another, which a person could not tell apart.
- A person may start one run of a row at once, from the Automations page: whatever its
  switch, without waiting for its pace, and whatever quota is left, as for any run a person
  starts. A row with a check still starts only when the check finds work, and its run is
  handed what the check printed; the number of agents at once holds, and so does that its
  skill is where a run's checkout starts. The run counts as the row's last start, so its
  pace counts from it. Picked over starting the command from the launcher: that run gets
  neither the row's publish pick nor what its check found.
- The state, `.agent-scheduler/state.json`, untracked, per user, hidden through git's
  exclude file the way `.branches/` is: on or off, keep-alive, the model, the spend
  cushion, this machine's switches, paces, numbers of agents and publish picks, the
  scheduler's pid, the last tick and what it decided. Nothing the tool knows is only in
  memory; a restart loses nothing.
- Keep-alive, whether the scheduler outlives what started it, is per user, in the state
  file. Picked over a line in the tracked schedule: in the schedule it would switch on the
  next person's machine the first time they pull.
- The scheduler's own model is per user, in the state file, set with `model <id>`, `opus`
  when unset: what a run on Claude Code starts on where neither its row's skill nor its
  person names another. Picked over a line in the tracked schedule alone, so each person
  controls what their own machine spends their quota on.

## The tick
- The checks in the cheapest order: the coding agent can run the command, it is switched
  on, it is due by its pace, the check says due, the cap, its skill is where a run's
  checkout starts, then the quota, for a run on Claude Code. The quota is read
  only when everything else says start, because the reading spawns the agent's CLI and its
  usage fetch is refused upstream when asked too often.
- A command whose skill is not on the commit a run's checkout starts from is not started,
  and says so. Asked only when a run would otherwise start, with origin's default branch
  fetched first as the run's own checkout does. Picked over starting it anyway, where the
  agent was told a command it does not know each time the command was due; and over asking
  for every command on every tick, which fetched every minute.
- The quota gate is OpenAgent's spend boundary, copied: a window in force may be used
  only as far as the week has elapsed, plus the user's cushion, half a day when unset.
  Picked over a plainer line (a window at 100% stands down): nothing would pace the week.
  Copied rather than moved into `agent-driver`, which is not this tool's to change.
- Two machines may mark for one command at once. Each machine counts by its own number: its
  marker stands while it ranks within that number among the records in time order, and a
  machine whose marker ranks past its number withdraws the marker and does not spawn. A
  push that fails twice is another machine getting there first: withdrawn, no spawn.
- A running record from another machine counts against its command's cap until that
  machine or a person ends it; a stuck command is fixed by hand.
- A run counts for the scheduled command its prompt names, and the scheduler decides that
  when it counts the records; the run's record holds only the prompt. Picked over the
  runner reading the schedule to name the command: the runner reads no scheduler file.
- The daily heartbeat and the transport retry OpenAgent's daemon had are dropped: a
  failed run leaves its queue entry for the next tick.

## The command line
- Every command prints one JSON document on stdout, one line for a person on stderr, and
  exits 0 for a result, 1 for a refusal or a failure, 2 for a command line that cannot be
  read: the skills' contract, so a person and a dashboard read it the same way.
- `start` is the only clock: OpenAgent's daemon does not tick. A dashboard that wants
  the scheduler on while it is open runs `start` when it opens and
  `stop --unless-keep-alive` when it closes, from a hook file of the user's that names
  the tool; OpenAgent's daemon calls no tool by name. Picked over the daemon calling the
  tick, which would have made the daemon call the tool by name.
- A stop waits for the tick in flight, and that tick starts nothing more: the readings are
  where a tick spends its seconds, and a person who said stop gets no new agent. The ending
  scheduler clears only its own pid from the state, since a dashboard's close hook stops one
  scheduler and its open hook starts the next before the first is over. Picked over killing
  the tick mid-flight, which could leave a marker half written.
- `stop --unless-keep-alive` is the one reader of keep-alive: it leaves a keep-alive
  scheduler running and stops any other, so the line a dashboard runs when it closes
  honours the user's keep-alive while a person's plain `stop` still stops. Picked over
  `stop` reading keep-alive always (a person's stop must stop) and over a separate `close`
  verb (one stop).

## The dashboard part
- The scheduler brings its own part of a dashboard: an Automations page (one row per
  scheduled command, with its switch, its pace, its number of agents and its publish pick),
  a Settings entry (the spend cushion, each project's own) and an Overview card (on or off, the last tick).
  All read `status` and write through `offset`, `switch`, `pace`, `agents`, `agent`, `model`, `publish`,
  `add`, `edit` and `remove`; an automation is read through `show`, a check is tried
  through `try`, and a row is started at once through `now`.
  Picked over a hook line per setting that a dashboard runs, and over the dashboard reading
  the state file by name. The rows are on a page of their own, picked over rows inside
  Settings: Settings keeps only what reaches every project.
- The rows of the Automations page are the schedule as the project's files say it at that
  moment, which `status` reads: a row saved, changed or removed shows at once, also where
  no scheduler is running. Picked over listing what the scheduler last read, where a new
  row showed up to a minute later, and never without a scheduler.
- An automation's shell line can be written from what it waits for, said in plain words:
  `write-line` asks the coding agent the row is on (Claude Code for a new one) in one
  session with no tools, in an empty folder, the way a run is named. The prompt hands it
  the line's contract, the project's origin and whether `gh` is here, since it cannot look.
  The line is only put in the form's box: the agent never runs it nor saves it; the person
  reads it, tries it with "Try it" and saves the row. Picked over a full run in the project,
  which takes far longer than the 30 seconds a dashboard waits for a command.
