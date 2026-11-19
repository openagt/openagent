Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The tickets
- Two callers: the command an agent runs, and a dashboard. The package's own module reads
  the tickets through its server part (#2394, decision 8), this machine's copy with no
  fetch, because its pages poll and the writer there keeps the checkout synced; it changes
  them through the command, as an agent does, lifting a dead agent's claim through
  `release --force`. OpenAgent reads them through the command (`list --local`, the same
  copy), found by the package's `openagent.tickets` declaration. A dashboard importing the
  package was the alternative and was not taken: the dashboard names no skill. The library
  a long-lived program called to keep the branch checked out and claim tickets for the
  agents it starts stays in the package; nothing calls it now. The executable is
  `tickets`. The package ships `SKILL.md`, the agent's instructions.
- A ticket is a markdown file in `tickets/`. Its plan and its claim sit beside it:
  `<name>.plan.md` and `<name>.lock.md`, `<name>` the filename without `.md`.
- Tickets live on `agent-data`, the branch `@openagt/agent-data` names, never on a code
  branch. The program links `tickets` at the project root to the relative target
  `.branches/agent-data/tickets`, only when nothing of that name sits at the root; the
  target may not exist yet, so the link dangles until the first ticket lands. The link is
  hidden by two rules in `.git/info/exclude`, `/tickets` then `!/tickets/`. `/tickets`
  hides the link, `!/tickets/` re-admits directories, which a symlink is not, so the
  persistent checkout still commits its own `tickets/` under the same repo-wide exclude.
- Closing a ticket deletes it, its plan and its claim, and nothing else; a queue entry
  linking it stays until `queue done`.
- A ticket closes when its pull request merges, never when the work is committed: a
  pull request closed unmerged must leave the ticket. In between the ticket is in review:
  it carries the pull request as a `PR:` line, written by the agent that opened it, which
  then releases its claim; a ticket in review is skipped for work and never queued. The
  close itself is the tracker update's: the pull request's body names the ticket it
  closes (`Closes tickets/<file>`) and the issue (`Closes #<number>`), and the routine
  that syncs the tickets with the tracker closes the tickets of merged pull requests and
  of closed issues. Picked over the agent holding its claim until the merge (a close by
  anyone but the holder is refused), over a workflow on the git host (not every user has
  one) and over a routine of its own (an agent per close).
- A ticket that waits on something outside the work says so in a `Waiting:` line above its
  title, and no agent is handed it or a plan for it until a person removes the line.
  Picked over the agent writing the wait into the ticket's text, which the listing never
  shows, so the ticket was queued again every six hours; and over the agent closing the
  ticket, which is a person's call.
- A ticket's row, the same fields in `list` and `show`: the title from its `# ` line, the
  summary from the first prose line after `## TLDR`, else after the title, scanning past
  headings, `Priority:` lowercased.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-tickets@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx tickets` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.

## Flow: a claim
- A claim is a committed file holding one line, `CLAIMED: <who>`, so agents on other
  machines see it.
- One claim per ticket; it never expires: it lifts when the ticket is released or
  closed, otherwise only by a person: `release --force`, from the dashboard or a shell,
  lifts anyone's claim and needs no identity. Without the flag the command lifts only
  its own lock, and closes only when the ticket has no lock or its own, `not-holder`
  otherwise. Releasing an unclaimed ticket is a refusal.
- A lock is written only by a claim; someone else's `claim` is refused while it exists.
  `put` ignores it, so an import can refresh a ticket someone holds.
- A claim the program committed but could not push still counts: the commit already guards
  this machine's readers, and the gap is logged. A write that could not commit claims
  nothing. The program's release is judged the same way: committed counts, pushed or not.
- A claim answers who claimed the ticket before: every holder the lock file's history
  names, newest first, each once, the claimer itself left out. The history keeps a
  released claim, and every agent that works a ticket claims it, so the answer arrives
  when the agent needs it. Picked over the run record naming its ticket (the run starts
  before the agent picks one) and over the agent tagging its own run (it has to remember).
- Claiming a ticket you already hold succeeds and writes nothing, so a re-run does not
  read its own lock as someone else's.
- The holder is never typed: `AGENT_ID` when non-blank, else the current branch. The id
  outlives the branch: a rename mid-session would leave a lock naming a branch nobody
  answers to. A checkout on no branch is refused, never claimed as `HEAD`. The checkout's
  folder name is not read: the layout is the caller's.
- The program says whether a claim is for planning or implementing: a claim for planning
  is skipped, no lock written, when the ticket already has a plan, unless the lock is
  already this holder's; a claim for implementing ignores the plan; only someone else's
  lock stands in its way. The command always claims to implement.
- The lock's existence is the claim: the holder it names decides who may close or release,
  not whether the ticket counts as locked.

## Flow: queueing a ticket
- The package never reads or writes the queue. A ticket is queued by the caller as a
  markdown link to the ticket, the title as its label; the program reads the link back to
  claim the ticket for the agent it starts. The entry takes the ticket's priority; a
  ticket whose `Priority:` is missing or unreadable counts as 5, never 10 or 0: those ends
  (act immediately, only if capacity) are deliberate picks.

## Flow: the command
- Every command names a ticket by its bare filename or its `tickets/<file>` path, so a
  queue entry's link target can be pasted in as is; a sibling's name (`.plan.md`,
  `.lock.md`) is `invalid-path` to every command, `put` taking `.plan.md` and `meta.json`
  the exceptions.
- `meta` reads `meta.json` for its one key, `lastImportedAt`, and `put meta.json` writes
  it: the routine that syncs the tickets with the tracker records its import time that
  way, no program of its own.
- A read fetches origin once and reads everything from that copy: only origin has every
  writer's pushes, this command's own included. With no origin the local branch is read:
  writes are refused there, so nobody else can have moved it.
- Every command that runs prints one JSON document, the result or the refusal. A refusal
  also puts one line on stderr and exits 1. A malformed command line (an unknown flag, the
  wrong argument count) is rejected first: the usage on stderr, nothing on stdout, exit 2.
  A file no command may touch refuses with `invalid-path`. Anything a command throws
  refuses with `git-failed`. Outside a repository a command refuses `not-a-repo`; only
  git's own "not a git repository" reads as that.
- `list` answers with a JSON array and `meta` with the bare stamp object (`{}` when none);
  every other result and every refusal is an object with `ok`.
- The command's write is one commit per command, pushed straight to origin when the
  project shares its records, else committed through the machine's checkout. The push
  goes through a throwaway worktree at origin's tip; one that loses a race is re-applied
  on the new tip by `@openagt/agent-data`. The program's writes go through its persistent checkout's
  cycle instead.
- The Overview's Hot tickets card is this package's, reading the tickets like the page, with
  three lanes: claimed; unclaimed at priority 7 or up, neither in review nor waiting; and
  waiting, at any priority. Picked over the dashboard's own card fed by the tickets provider,
  which also had a lane for queued tickets: that lane was the dashboard knowing both this
  package and the queue's. A row's way onto the queue is the action the queue package offers
  on links, drawn beside the row where a project has it.
- The pages never start, plan or queue a ticket in review or waiting, the rule the skill gives
  an agent: the row says why instead. Waiting has its own lane on the Hot tickets card,
  because only a person removes the line once the wait is over. Picked over a separate
  Waiting card (one more box for a short list) and over no list at all (a waiting ticket is
  forgotten). A ticket in review gets no lane: its open pull request is listed already.

## The commands
- The commands about the tickets ship inside them (#2394, decision 25): `plan`,
  `plan-tickets`, `triage`, `update-tickets` and `suggest-tickets-to-work-on`, each a skill
  of its own that the plugin gives a project's runs where it is on, its text in
  `skills/<command>/` like the capability skills'. Picked over one package per command,
  `@openagt/skill-<command>`, each installed and switched on by itself, which let a project
  have a command without the data it is about.
- Two kinds of skill: capability skills (`branches`, `tickets`, `queue`, `logs`, `github`),
  each a SKILL.md and a command, each saying how to do one thing; and command skills, each a
  SKILL.md only, each a job that composes capabilities. A command may name its own plugin's
  skill and command (#2394, decision 25), and assumes no other capability; where the job is
  broken without one, it says so in capability words and stops. The check of its `schedule`, in the front
  matter, is the one place that names other commands: the scheduler runs it and the agent is
  never given it. Picked over a command naming every capability it uses, which would tie the
  job to their packages. A capability never names another skill.
- A command is marked `disable-model-invocation`: a person or a runner fires it, the agent
  never picks it on its own.

## plan
- The plan command ends on the ticket and its plan, the ways to do the work and the one
  it recommends; a person reads the plan and queues the ticket. Picked over the agent
  queuing or working its own ticket, and over the alternatives the old system prompt had
  every agent show before every change: the options are weighed once, in the plan.

## plan-tickets
- A runner fires a command by its name, `/plan-tickets`; the agent's harness expands the
  skill. The command's words are the rules of the job, in numbers read off the ticket
  listing — a ticket needs a plan when it has none or an outdated one, and is neither held
  nor in review nor waiting nor on the queue; at most ten a run, highest priority first,
  then oldest; one entry per ticket, `Create tickets/<name>.plan.md`, at the ticket's own
  priority; no plan written by this agent — never a skill's name or command. Picked over
  the agent ranking the tickets and picking each priority after reading them, which two
  runs never did the same way; and over one agent per ticket with a claim: the queue is
  the fan-out, and the queued work writes each plan one at a time.

## triage
- One triage command with a mode word, `/triage quick` and `/triage consensual`, and both
  modes when the word is missing; each mode is a scheduled command of its own, with its own
  pace and its own switch. Picked over two commands one sentence apart (the same job
  written twice), and over one scheduled command running both modes (significant work would
  then be queued wherever quick wins are, with no switch of its own).
- The command's words are the rules of the job, in numbers two runs agree on, read off the
  ticket listing: a quick win is a planned ticket with effort 2 or less and uncertainty 2
  or less; consensual work is a planned ticket with uncertainty 3 or less that is no quick
  win; a plan without both numbers qualifies for nothing; a ticket on the queue, held, in
  review, waiting or whose plan is outdated is skipped; every pick goes on the queue at
  the ticket's priority, lowest effort first; only queue, never do, so a human can still
  veto on the queue. Picked over "low effort and no uncertainty" and "significant,
  consensual", which one run read as uncertainty 0 (never met) and another as uncertainty
  3; over bumping quick wins one above their priority, which contradicted the rule every
  ticket is queued by; and over skipping a ticket whose plan records a decision not to do
  the work, which no plan key marks and two runs read differently (such a ticket is closed
  by hand).

## update-tickets
- A runner fires a command by its name, `/update-tickets`; the agent's harness expands the
  skill. The command's words are the rules of the job — note the time before fetching and
  record it after, so nothing edited meanwhile is missed; only what changed since the last
  import; one ticket per issue, updated in place, closed when the issue is; the tickets
  named by the pull requests merged since the last import closed too, which is how a
  ticket closes at its merge; an error in capability words when the tracker cannot be
  reached, or tickets exist with no last-import time — never a skill's name or command; no
  import time recorded when anything fails, so the next run fetches the same changes
  again.
- The project's schedule starts `update-tickets` only when an issue changed since the last
  import, or a pull request merged since then has a line `Closes tickets/` followed by a
  file name, or when no import time is recorded and there are no tickets: a first import.
  Picked over starting it on any merged pull request, which ran the job about
  forty times a week to change nothing.
- An open issue with no ticket gets one only when it was opened or reopened since the last
  import. Picked over giving one to every changed open issue with no ticket, which brings
  back a ticket closed on purpose and makes one for every old issue a comment or a bot
  touches.
