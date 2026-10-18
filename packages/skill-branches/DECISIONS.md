Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The checkout
- One checkout per agent, a git worktree of the user's repository under `.branches/`,
  branched from origin's default branch, fetched first (5 seconds at most, then the local
  copy), unless the caller names a base, as Claude Code's own worktrees do by default.
  Agents run in parallel, and the user's own copy is never an agent's workspace. The
  project's head was the earlier rule and was dropped: it is whatever the user has checked
  out, so an agent built on the user's unpushed work and its push published it. A
  repository with no remote still starts from the head: there is nothing else. A worktree,
  not a clone, so every checkout shares the repository's objects and refs.
- The repository's exclude file hides `.branches/` from the first checkout on: an
  untracked folder at the root would ride a sweeping `git add -A` onto a code branch, and
  `.gitignore` is tracked.
- A checkout starts as branch `agent-<id>` in folder `.branches/agent-<id>/`; `<id>`
  comes from the program that starts the agent, and must match `[A-Za-z0-9_-]+`, so no
  id can build a path outside `.branches/`.
  `npx @openagt/skill-branches@0.1 name <name>` (`[a-z0-9-]+`; the skill asks for a
  leading letter or digit: at the command line a leading `-` reads as a flag, a usage
  error, and the name check itself does not mind it) renames the branch to
  `agent-<name>`: a rename, not a new branch, so nothing is left behind; the folder
  keeps the id, since the agent is running inside it. A checkout on no branch is neither
  renamed nor reclaimed; `status` answers it without a `branch`.
- After a checkout is made, and after the command names or removes one, each checkout
  whose branch differs from its folder name gets a sibling link `.branches/<branch>` to
  its folder, relative; a detached checkout or a slashed branch gets none. A link whose
  target is an `agent-*` name, `agent-data` aside, is the package's to remove, whatever
  the link's own name, and whether or not the target exists; anything else at a link's
  path is left alone. A removal through the library leaves a stale link until the next
  such pass.
- No name the package mints holds a `/`: a folder and a link are named after a branch, and
  a cloud session (a hosted agent run, started on a branch) cannot start on a slashed ref.
  The package renames and deletes only `agent-*` branches. `attach` takes the caller's
  branch as given, slash or not.
- `agent-data` is `@openagt/agent-data`'s data branch, checked out as
  `.branches/agent-data` by the program that keeps that branch checked out (a daemon), not
  by this package. Never listed, renamed or deleted; `data` is refused as an id, and an
  agent naming itself `data` gets `agent-data-2`.
- A taken name gets `-2`, `-3`, … instead of a refusal: the agent asked for a name and
  reads back the one it got. Taken means any local or remote-tracking branch, so the later
  push cannot land on someone else's branch. The branch the checkout carries right now,
  suffix included, is not counted.
- Continuing an agent puts it back on the branch its work is on, even one the package did
  not make; a branch gone locally comes back from origin's copy, and one gone everywhere is
  recreated where the agent's first branch started: the base the caller names, else
  origin's default branch: every branch the package deletes held no commit of its own.
- The user's installed dependencies are linked into the checkout, not copied or
  reinstalled: one link per entry of the folder, absolute, so an install in the checkout
  writes into the checkout. A scope like `@acme` is mirrored the same way one level down,
  so a scoped install writes into the checkout too. Every dependency folder down to two
  levels under the root is linked, so a workspace package's own dependencies are there
  too. Of the dot-entries only `.bin` is linked, so the agent runs the project's tools, as
  one entry, so a bin an install adds lands in the user's folder too; the others (`.pnpm`,
  `.modules.yaml`) would tell the package manager the checkout's tree was installed there,
  which it was not.
- Everything after the worktree is best-effort: a checkout missing any of it is a worse
  run, not a failed one.

## Flow: reclaim
Deleting an agent's checkout to free disk, only once its branch holds everything in it: a
clean tree. The branch stays on this machine. Nothing is pushed: publishing is a person's
call, never a cleanup's. Pushing the branch first, so the remote had everything before the
checkout went, was the earlier rule and was dropped: every run published its work by
ending.

- Nothing is committed on the agent's behalf: a checkout with uncommitted work, untracked
  files included, is kept until a person commits or deletes it, and nothing of it is
  pushed.
- An `agent-*` branch that holds nothing of its own goes with its checkout, deleted with
  `-D`: git's own merged test asks the wrong question. It holds nothing when it has no
  commit past the commit it was made at, which the caller names (`remove --from`), or when
  origin's default branch already has everything on it, read from the local
  remote-tracking ref, never a fetch. Either is enough: only the first can answer in a
  project with no remote, only the second for a caller that names no commit.
  Any other name's remote-tracking ref holding the tip was the earlier rule and was
  dropped: a branch another agent was started from lost its branch once that agent's
  branch was pushed. The named commit having to be on the remote was dropped too: nothing
  is on the remote before a person publishes, so a subagent that committed nothing kept
  its branch for good.
- An agent that switched to another branch leaves `agent-<id>` behind; it goes with the
  checkout once the branch the agent ended on contains it.
- A folder under `.branches/` that git no longer knows as a worktree is left alone, and
  `list` still shows it, without a branch: a git command run inside it would act on the
  user's own checkout.
- A removal git refuses as unclean after the clean check passed is forced, and says so on
  stderr: an ignored build artifact must not strand a checkout for good.
- `remove` and `prune` never push. A removal judges the birth branch before anything
  goes, then removes the checkout, then the branches, since git will not delete a branch
  a worktree has out.
- `remove --discard` drops a checkout whatever it holds, uncommitted work included,
  deleting no branch: the person's way past the reclaim rule for a run they throw away. Picked over
  the dashboard forcing the removal through git itself.
- The package reads no configuration and never asks whether an agent still runs: the
  caller may pass a hook that runs just before the checkout goes, to stop whatever serves
  the tree; the command line passes no hook.

## The skill
- The package knows git and nothing beyond it: it pushes a branch and never opens or
  lands a pull request, and it names no git host and no git host package. The pull request is
  the git host package's own command, composed after the push by whoever runs both: the
  agent through its skills, the dashboard through the two declared commands. Picked over
  the package opening the request itself, which put the git host's tool inside the git skill
  and made another git host a change to this package.
- The agent pushes its branch only when asked to publish, by its task or by the person:
  `npx @openagt/skill-branches@0.1 push`, once its checkout is clean. Until then its
  work stays on this machine. Pushing when it finishes was the earlier rule and was
  dropped: a branch on the remote is in front of everyone who watches the repository,
  and that is the person's act. Picked over whoever started the agent pushing for it.
- A person pushes a finished agent's branch through the same `push`, by name
  (`--branch`): the checkout on it under the agent's clean rule, else the branch itself,
  pushed when this machine has it and left as it is when only origin has it. Picked over
  a second push path in the dashboard.
- `show` answers a branch's git facts only, its commits and files beyond the base, whether
  it is pushed and merged, what its checkout left uncommitted; its pull request is the
  caller's question. Picked over the package asking the git host, which would have put a
  network call inside every poll.
- `show` is told the commit a branch was made at (`--from`) and measures the branch from
  it when the default branch cannot tell its own work: a branch made from another branch
  would show that branch's work as its own, and a merged branch would show none. A branch
  made from the default branch and not merged yet is still measured from the default
  branch, so what it took in from there by a merge or a rebase is not counted as its own.
- `ahead` answers many branches in one read: how many commits of its own each has beyond
  the base, whether origin has it, whether it was pushed and origin's copy is gone since,
  whether the default branch has it; no files. Picked over `show` for every run's branch,
  which lists files and took seconds over branches made before a history rewrite. A branch
  whose copy on origin was deleted, as a merged pull request's is, was pushed: it is not
  work that never left this machine.
- `show` reads a full commit id in place of a branch. Picked over a second command for a
  branch that is gone: the caller wants the same answer.
- `list` and `show` answer a branch's `name`, the name the agent gave its work: the branch
  minus the package's prefix, and nothing while a checkout is still on the branch it was
  created on. The naming rule stays the package's. Picked over the dashboard cutting the prefix
  off, which was the dashboard knowing how the package names a branch.
- `list` and `show` never touch the network: they read the local refs and the checkouts on
  disk, so a caller may poll them.
- The command has a second caller, the dashboard, for `list`, `show`, `push --branch` and
  `remove`, declared as the project's branches provider
  (`"openagent": { "branches": "branches" }`).
- Before its first change the agent names its session, saying what the work is, unless
  its branch already differs from its folder name, as a continued agent's does: it is
  already named. The agent finishes only when `npx @openagt/skill-branches@0.1 status`
  reports the checkout clean, or after saying what remains is not its own; an agent that
  needs anything outside its checkout stops and says so.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-branches@0.1`: the name is ours on npm, so no other package can
  run under it, and nothing is installed in the project. Picked over `npx branches` with
  the package as a dependency of the project, which ran whatever package holds that name
  on npm where the install was missing, and which a project without Node could not have.
- Every command that runs prints one JSON document on stdout: the result or the refusal. A
  refusal (a rule saying no) adds one line for a person on stderr and exits 1. A malformed
  command line (an unknown flag, the wrong argument count) never gets that far: the usage
  on stderr, nothing on stdout, exit 2. An id the charset rejects is a refusal,
  `invalid-id`, not a usage error. A command that throws is reported like a refusal,
  reason `git-failed`, the error's own line as `detail` on stdout and on stderr.
- `create`, `attach`, `show`, `list`, `remove`, `prune` and `push --branch` act on the
  project, found from the `.branches/` layout even from inside a checkout; `name`,
  `status` and a bare `push` act on the checkout the command runs in, found from anywhere
  inside it; `status` also takes the path of a checkout root.
- `list` and `show` answer with a bare JSON array; every other result and every refusal is
  an object whose `ok` tells the two apart.
- Outside a repository, a command that needs one refuses with `not-a-repo`: only git's own
  "not a git repository" reads as that; every other failure stays `git-failed`.
- The skill tells the agent where it is: on `agent-*` the checkout is its whole workspace,
  and the dependency files and skill folders in it are links to the user's copies, never
  edited; on any other branch under `.branches/` it was continued on that branch on
  purpose and stays; anywhere else it is a plain clone, and the agent makes its
  `agent-<name>` branch with git before its first change, another name if that one exists
  locally or on origin. `status`, `name` and a bare `push` are the agent's commands; the
  rest are the caller's.
- Every checkout holds the package's command and the package itself, linked as
  `node_modules/.bin/branches` and `node_modules/@openagt/skill-branches` and hidden
  through the repository's exclude, unless the project installed its own copy. `npx`
  runs a copy of the package it finds in the checkout, by the command's name, so the
  skill's full name runs the copy that made the checkout, with nothing downloaded and no
  network. Beside another tool that holds the name `branches` in the project the package
  is not linked, and the full name is left to npm. Picked over leaving the full name to
  npm alone, which takes a second a call and fails where the network is down.
- Each agent tool (Claude Code, Codex) looks for skills in its own folder at the
  checkout root: `.claude/skills`, `.agents/skills`. In every checkout it makes, the
  package links its own folder, which holds `SKILL.md`, into both as `branches`, hidden
  through the repository's exclude. An entry already there, a committed skill say, is
  left alone. A caller may name further skills to link in beside it, each under its own
  name and with its package and command when it has one, not from the command line: the
  skills that come with every run, whatever the project committed.
- `merge <branch>` merges a branch into the project's default branch, on this machine, in
  the project's folder, which must be on that branch. It is how a finished agent's work
  reaches the folder where there is no remote to push to and no pull request to merge. A
  merge that conflicts is undone and names the files: nothing is left half merged. Once the
  work is in, an agent's branch is deleted, since the default branch holds everything it
  held. A branch whose checkout is still there is kept with it: an agent may be working in
  that checkout (one asked to merge its own work runs the command from inside it), and
  removing it would take the agent's diary with it. A branch that is no agent's is kept. Picked over
  leaving the conflict in the person's folder to fix by hand, and over keeping the merged
  branch.
- `branches cleanup` removes the agents' checkouts the reclaim rule lets go, then
  `.branches` once it is empty, and is what a dashboard runs when a project is removed with
  its files. A checkout with uncommitted work and a branch with work on it stay. Picked over
  a dashboard deleting `.branches` itself.
