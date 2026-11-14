Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The queue
- Two callers: the command an agent runs, and a dashboard, which reads the queue through
  the command (`--local`, `--full`) and adds to it through the command as its module's
  action, found by the package's `openagent.queue` declaration. A dashboard importing the
  package was the alternative and was not taken: the dashboard names no skill. The
  executable is `queue`. The package ships `SKILL.md`, the agent's instructions.
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
  `npx @openagt/skill-queue@0.1`: the name is ours on npm, so no other package can run
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
- A bare `queue` answers with a JSON array of strings; with `--full`, of objects, each
  entry with the priority section it sits in, for the dashboard's page. Every other
  result and every refusal is an object with `ok`.
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
- The Overview's AI Queue card is this package's, reading `queue --local` like the page and
  starting agents through the dashboard: one on an entry, landing on it, or one per top entry
  without landing. Picked over a card in the dashboard fed by the queue provider, which drew
  an empty queue for a project with no queue package. The card names no tickets: a queued
  ticket reads as its title and opens nothing here.
