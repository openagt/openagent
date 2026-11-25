# @openagt/git-branches

Where a run works, for OpenAgent: a checkout of its own on a branch named `agent-<name>`, beside the
project's folder, and a copy of each repo it was given as context. Once the run has ended, what its
branch holds and where its work can go next.

What it brings:

- **The run's checkout**, made before anything is linked into it, and reclaimed once the record says
  how the run ended: only what is committed may go, and a branch that holds work stays. A session
  with no project works in a folder of its own, its repos copied into it.
- **The project's row** in the panel of a session's work above its message box (`chat.work`): the
  run's branch and its pull request; while the run works, whether its checkout holds changes, the
  other modules' words (`chat.summary`) and "Committing…"; once it has ended, what the branch holds
  (the size of the change, its commits and files in the hover). It comes when there is something
  to say, holds while the branch settles after a turn, and goes once nothing is left: a request
  merged or closed, or work landed. A row per copy of a repo the session holds work in follows it.
- **The next steps there** (`chat.handoff`), each offered from what the branch holds: Commit, which
  asks the agent to commit what it left uncommitted, the bar saying "Committing…" while it does; Discard changes, asked first; Publish branch, a
  push as one of OpenAgent's accounts; Merge, for a project with no remote, on this machine; and a
  copy's work brought back to the folder it was copied from. A pull request is the git host module's.
- **Remove worktree** in the session's menu (`chat.menu`), with the checkout's size on disk beside
  it.
- **The branch a run starts from**, in the row above the message box (`composer.control` at
  `start`): in the launcher a menu of the project's main branch, the folder's own branch and what
  origin has now, its pick kept for every next run of the project on this computer (the
  `git-branches.startFrom` setting); in a session, the branch it started from.
- **The repos a session works with**, under the message box (`composer.control` at `context`): in
  the launcher, a menu of the projects and of every module's repos on this computer
  (`composer.where`), each ticked into the run's options under the name its copy will have in the
  session's folder; in a session, the repos it started with.
- **Commit and Publish branch** in the "When it finishes" menu (`composer.auto`), Publish branch only
  where the work can be pushed.
- **What a project needs** (`app.attention`): its folder behind its remote's main branch, with
  Update folder as the fix (`attention.fix`), and a start pick gone from origin. **What waits on
  the person** there: a finished run's files left uncommitted ("Needs commit") and its commits never
  pushed ("Needs push"), read from the project's runs (`AppContext.runs`) and this package's own
  branches.

Every talk with a remote goes as an account of OpenAgent's (`RpcHost.gitAccess`, which the git
host's module answers), never the person's own login. Its Node part is the module (`./module`), with
a server part for the dashboard's reads and presses (`./server`), and the `branches` command its
runs call (`SKILL.md`).
