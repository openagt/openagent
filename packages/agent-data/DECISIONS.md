Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The package
- A **library, not a skill**: no `SKILL.md`, no command. Skills import it; they never
  import each other.
- Named for the `agent-data` branch, but no function hardcodes it: every one that touches
  a branch takes it as an argument.
- `.branches/` holds a project's persistent checkouts, one per branch at
  `.branches/<branch>`: the agents' own (made by other packages) and the data branch's
  (made here). The directory name is exported. Dotted so a `*` glob skips it: each
  checkout is a full copy, so a tool that descends does N times the work.
- A branch's persistent checkout is one per clone, in the clone's own directory, whichever
  worktree asks. Picked over one per worktree, which git refuses.
- `.branches/` is hidden through the common git dir's `info/exclude`, never a committed
  `.gitignore`: the library must not touch tracked files; a per-worktree `info/exclude` is
  never read, and one line there, written once, covers every checkout. Best-effort: the
  checkout stands even when the rule could not be written.
- Every git call through the package's own runner has a time budget; a call that outruns
  it fails as a timeout, its own error kind, never as a plain failure: a killed `push` may
  have half landed.

## Where a project's data is
- By default in the person's own folder on the machine, `~/.openagent`: a git repository with
  no remote, each project under `projects/<project>/`, named by its repository's address so it
  is the same on every machine. Picked over a branch of every project's repository: adding a
  project puts nothing in its repository.
- A project the person shares writes to its own repository's `agent-data` branch, as before.
  Picked over moving every project to the personal folder until a folder can have a remote:
  records shared with other machines and cloud sessions keep reaching them.
- One place at a time: the share switch moves the project's data to the other place, never a
  copy in each.
- The personal folder may sync with one repository of the person's (Settings › Folders), so
  each of their machines has the same records. Picked first over sending one project's data to a
  team's repository, which comes after.

## The branch
- A shared project's branch holds the agents' data (tickets, the queue) the way `gh-pages`
  holds a site; code branches hold only code. Every write that changes
  something pushes when the person shares the branch with the remote, and a pull is a
  cycle of its own, so a machine that writes nothing still gets what the others pushed.
- The branch leaves the machine only on the person's word: one git setting in the
  repository, `agent-data.share`, unset means off. Off is both ways, nothing pushed and
  nothing fetched: taking without giving would rebase kept commits onto origin's forever,
  and a conflict there drops them.
- One branch for all skills, each with its own folder or file. Not one per skill: every
  extra branch needs its own checkout and its own sync failure to report.
- Missing locally, it is adopted from origin's copy; missing there too, it is born an
  orphan branch, so no code commit is ever in its history.
- The name is written once, in `names`, as `DATA_BRANCH`, and imported everywhere else.
  `names` is its own entry point with no node imports, so browser code can import it.
- A read works from anywhere in the repository, an agent's worktree included: the checkout
  is looked for beside the real `.git`. A one-shot command opens the branch once: one
  fetch when the branch is shared with origin, every read off origin's copy (the local branch when there
  is no `origin/<branch>`), because its own writes go straight to the remote and never
  move the local branch. A read never fails: a missing file, a missing branch and a git
  that could not run all read as absent.

## Flow: a write
Fetch what others pushed → make the change → commit → push.

- Two writers. A long-lived process (the daemon, the scheduler, a run) writes in the
  clone's checkout, `.branches/<branch>`, one write at a time per repository and branch,
  across every process on the clone: a lock file beside the checkout; a live holder is
  waited for, a dead one's lock is taken over. Picked over a lock inside each process only
  (the scheduler's reset wiped a run's end record in the same second) and over runs writing
  through a throwaway worktree (the daemon and the scheduler would still share the
  checkout). The pull is that same cycle with an empty change, behind the same lock. A command an agent runs writes in a throwaway worktree
  outside the project, at the remote's tip (parentless when origin has no such branch),
  pushes, and deletes it whether or not the push landed. It never touches the process's
  checkout: that checkout's next write commits everything it finds, and a failed write
  resets it, new files included. Both try the push twice; the command's write then throws
  with nothing left to retry, the process's never throws: its callers are background
  ticks.
- A write is a re-runnable function, not a finished commit: a push that fails, a lost race
  or anything else, winds the attempt's commit back and runs the function again on the new
  files, so the change lands once. The message is the caller's: fixed, or a function run
  after the change, since a batch only knows what it did once done; the library's own are
  `create the <branch> branch` for the birth and `sync` for the pull. Never a force push.
  After two failed pushes the process's write reports the failure and the commit stays
  local in its checkout; the next write or pull rebases it onto the remote and pushes it
  with the new one. When that rebase fails, a conflict or anything else, the checkout is
  reset to origin's tip: the remote wins, every unpushed commit is dropped unreported,
  only the current change runs again.
- An op is handed a directory and writes into it; git keeps no empty directory, so a
  skill's folder vanishes with its last file and is absent on a new branch.
- The remote is always `origin`; a repository without one is remote-less whatever other
  remotes it has. Then the process's write commits locally and reports no error, a
  command's write commits locally through the checkout, and the pull is fine and says
  the branch stays here.
