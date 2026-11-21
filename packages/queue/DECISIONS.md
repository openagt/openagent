Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The queue
- Two callers: the command an agent runs, and a dashboard. The package's own module reads
  the queue through its server part (#2394, decision 8) and changes it through the command,
  as an agent does; OpenAgent reads it through the command (`--local`), found by the
  package's `openagent.queue` declaration. A dashboard importing the package was the
  alternative and was not taken: the dashboard names no skill. The executable is `queue`.
  The package ships `SKILL.md`, the agent's instructions.
- The queue is one markdown file on the branch, `TODO_AGENTS.md`: sections `## Priority
  10` down to `## Priority 0`, any `## Priority N` with N of one or two digits counts, in
  any case; any `-`, `*` or `N.` list item with text is an entry, wherever it sits.
  Entries are placed to keep the file sorted high to low; the command never re-sorts, and
  agents take file order. The Queue page shows the entries in that order, under the
  section each sits in: an entry above the first section shows first, as it is worked
  first. Sorting the page by priority was the alternative and was not taken: the page
  would show an order no agent follows.
- An entry is plain trimmed text: the task a future agent is started with. The package
  does not know tickets: a caller that queues a ticket writes the entry itself as a
  markdown link to the ticket, and reads the link back to claim the ticket for the agent
  it starts. No `--ticket` flag on the command.
- `queue add` creates the queue file when the branch has none. An entry with no priority
  goes at the end of the file, in whatever section ends it.
- Done means deleted, never checked off: a `- [x]` or `- [X]` line is not an open entry; a
  `- [ ]` line is, printed without its box and deleted whole.
- The skill calls the command by its full name and a version range,
  `npx @openagt/queue@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx queue` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.

## Flow: the command
- A read fetches origin once and reads everything from that copy (the library's queue
  read fetches only when asked): only origin has every writer's pushes, this command's
  own included. Except with `--local`, the dashboard's: it reads this machine's copy
  (the persistent checkout at `.branches/agent-data`, else the local branch) with no
  fetch, because the dashboard polls and the writer on that machine keeps the checkout
  synced. With no origin the local branch is read: writes are refused there, so nobody
  else can have moved it.
- Every command that runs prints one JSON document, the result or the refusal. A refusal
  also puts one line on stderr and exits 1. A malformed command line (an unknown flag, the
  wrong argument count, an empty `queue add` text, a `--priority` off the 0-10 scale) is
  rejected first: the usage on stderr, nothing on stdout, exit 2. Anything a command
  throws refuses with `git-failed`. Outside a repository a command refuses `not-a-repo`;
  only git's own "not a git repository" reads as that.
- A bare `queue` answers with a JSON array of strings. Every other result and every
  refusal is an object with `ok`.
- The command's write is one commit per command, pushed straight to origin when the
  project shares its records, else committed through the machine's checkout. The push
  goes through a throwaway worktree at origin's tip; one that loses a race is re-applied
  on the new tip by `@openagt/agent-data`.
- `queue done` takes the entry as `queue` printed it, trimmed, removes the first such
  line, and refuses a line the queue does not have, an empty one included, decided inside
  the write.
- "Add to queue", the module's action, reads the open entries first and leaves a link
  already queued as it is: a link is queued when an open entry leads with a link to the
  same target, a plain text when an open entry is exactly that text. Picked over the
  caller deciding, since no page knows the queue: "add" means the set ends up queued,
  and a second entry would outlive the first's check-off as open work naming something
  done.
- The Overview's AI Queue card is this package's, reading the queue like the page and
  starting agents through the dashboard: one on an entry, landing on it, or one per top entry
  without landing. Picked over a card in the dashboard fed by the queue provider, which drew
  an empty queue for a project with no queue package. The card names no tickets: a queued
  ticket reads as its title and opens nothing here.

## The commands
- The commands about the queue ship inside it (#2394, decision 25): `work-queue`, a skill of
  its own that the plugin gives a project's runs where it is on, its text in the package's
  `commands/work-queue/`. Picked over one package per command,
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

## work-queue
- A runner fires a command by its name, `/work-queue`; the agent's harness expands the
  skill. The command's words are the rules of the job — one task, commit, publish as far
  as whoever started the run said; the pull request naming the ticket it closes, then
  mark done, the `PR:` line and the release are the ticketing system's own rule for queued
  work — never a skill's name or command. Picked over the run that started the agent
  publishing for it: the agent pushes through the branches skill and opens the pull
  request through the git host's skill, both already in its checkout. Picked over marking
  done before the publish: a publish that failed lost the task. Picked over closing the
  ticket at commit time: a pull request closed unmerged lost the ticket.
- A ticket with nothing to do until something outside the work happens gets a `Waiting:`
  line, and its entry is marked done; the agent never closes it. Picked over closing the
  ticket to stop it coming back.
- The agent takes the first open entry and claims its ticket first; an entry whose ticket
  someone else holds is left for them, and the agent takes the next one. Picked over
  stopping at a held claim.
- The schedule starts `work-queue` only while an entry names no claimed ticket. Picked
  over a run on every tick that finds every entry held and stops.
- A task whose whole work is changing other tickets closes its own ticket; a plan leaves
  its ticket open. Picked over leaving every ticket without a pull request open: a
  finished ticket left open is queued again.
