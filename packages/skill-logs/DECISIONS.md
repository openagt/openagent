Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The logs
- Three callers: the command an agent runs, which only reads; the program that ran an
  agent, which records the run through this package's functions when it is over; and a
  dashboard, which reads, deletes and patches runs through the command (`--local`,
  `--full`, `delete`, `patch`), found by the package's `openagent.runs` declaration. A
  dashboard importing the package was the alternative and was not taken: the dashboard
  names no skill. The executable is `logs`. The package ships `SKILL.md`, the agent's
  instructions.
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
- The card is small and the package's: `id`, `startedAt`, `endedAt`, `status`, `intent`,
  `driver`, `model`, `branch`, `pr`, `cost`. Everything else a writer records
  sits under one key of its own, `caller`, which the package stores and never reads.
  Owning the writer's whole record, renamed field by field, was rejected: a program's
  private fields would become a standalone package's public API. Under semver these
  fields are the branch's public API: a change to them is a major.
- A fifth status, `waiting`: the run ended on a question the agent asked and waits for the
  answer to resume it. A status rather than a field on the card, because every reader
  filters on the status and a waiting run is neither running nor done.
- The diary is JSON lines. The package knows four kinds — `said`, `result`, `ended`,
  `cost` — and skips every other line a writer adds. A writer maps its own events onto
  the four; the package never learns them. A line may carry more fields than its kind
  needs; they pass through.
- Agents only read. A note an agent leaves on its own run was considered and deferred: the
  record lands on the branch only when the run is over, so a note would need a file of its
  own or a record written at the start.
- The skill says when to look back: before planning or working a ticket, read the runs its
  claim names. Leaving that to the caller's prompts was the alternative and was not taken:
  outside the caller nobody would ever read the logs.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-logs@0.1`: the name is ours on npm, so no other package can run
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

## Flow: what the writer records
- A run is recorded once, when it is over, as one commit carrying both files. Late
  facts are patched onto the card afterwards, one commit per patch: the branch the work is
  on, the pull request, and that the work landed, which drops the branch and keeps its last
  commit and the commit the work began at under the writer's key. A run is deleted as one commit, both
  files. A run a dead writer left marked running is recorded again by the next writer that
  notices, ended, where it already sits. Nothing else on a card changes after it lands.
- The writer's persistent checkout is `.branches/agent-data`, and its writes go through
  that checkout's serialized cycle, the same as the other skills'. The command reads it
  only with `--local`, and writes through its cycle only for `delete` and `patch`.
