Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The logs
- Three callers: the command an agent runs, which only reads; the program that ran an
  agent, which records the run through agent-driver's record when it is over (#2394); and a
  dashboard. The package's own module, its Logs page and Members card, reads the runs
  through its server part (#2394, decision 8), as the command reads them. OpenAgent reads,
  deletes and patches them through the command (`--local`, `--full`, `delete`, `patch`),
  found by the package's `openagent.runs` declaration. A dashboard importing the package
  was the alternative and was not taken: the dashboard names no skill. The executable is
  `logs`. The package ships `SKILL.md`, the agent's instructions.
- The Logs page lists the runs of the projects it is shown for, and no session with no
  project: the logs are a project's plugin, and such a session is in no project. It is in
  the sidebar's Log, with the dashboard's own rows. Picked over listing those sessions on
  the page with every project showing (#2418), which had the plugin read the dashboard's
  own list of sessions it is no plugin of.
- Agents only read. A note an agent leaves on its own run was considered and deferred: the
  record lands on the branch only when the run is over, so a note would need a file of its
  own or a record written at the start.
- The skill says when to look back: before planning or working a ticket, read the runs its
  claim names. Leaving that to the caller's prompts was the alternative and was not taken:
  outside the caller nobody would ever read the logs.
- The skill calls the command by its full name and a version range,
  `npx @openagt/logs@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx logs` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.

## Flow: the command
- `logs` lists newest first and prints the package's fields only, never `caller`, except
  with `--full`, the dashboard's flag: the writer's bookkeeping is not the agent's
  business.
- `logs` prints the newest 20 runs unless `--limit` says otherwise: a list of every run,
  each with its prompt, is more than an agent should read for a look back.
- `show` prints the card with the four kinds of diary line, never the whole diary,
  except with `--full`: the dashboard replays the whole diary through the command. An
  agent cannot read a hundred kilobytes of a writer's bookkeeping.
- A read fetches origin once and reads everything from that copy: only origin has every
  writer's pushes. Except with `--local`, the dashboard's: it reads the checkout at
  `.branches/agent-data` with no fetch, because the dashboard polls and the writer on
  that machine keeps the checkout synced. With no origin the local branch is read.
  Outside a repository a command refuses `not-a-repo`; only git's own "not a git
  repository" reads as that. An id no run has refuses `no-run`.
- Every command that runs prints one JSON document. A refusal also puts one line on
  stderr and exits 1. A malformed command line (an unknown flag, the wrong argument
  count, a `--limit` that is not a whole number above 0, an id that is not one) is
  rejected first: the usage on stderr, nothing on stdout, exit 2. Anything a command
  throws refuses with `git-failed`.
- The command writes through the cycle of the writer's checkout, `.branches/agent-data`,
  only for `delete` and `patch`.
