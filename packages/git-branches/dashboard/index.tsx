// git-branches' UI part: the package's `./dashboard` export. The project's row in the panel of a
// session's work above its message box (`chat.work`): the run's branch, while it works whether its
// checkout holds changes and "Committing…" while the agent does what its Commit press asked, once
// it has ended what its branch holds, and its next steps there (`chat.handoff`): Commit, Publish
// branch, Merge on this machine, a copy's work brought back to its folder, and uncommitted work
// discarded; a row per copy of a repo the session holds work in after it (`chat.work`), and each
// copy by the repository it is a copy of in the Activity panel's Environment (`chat.environment`);
// Remove worktree in the session's menu (`chat.menu`); under the box (`composer.control` at
// `context`), after the project, the repos a session works with, each copied into its folder, and
// the branch a run starts from, as Claude Code on the web has them; the Auto menu's Commit and Publish branch
// (`composer.auto`); and the press that brings a project's folder up to its remote
// (`attention.fix`), for the item its Node part says. What it reads and does is its own server
// part's (`../src/server.ts`).
import { defineUiModule, formatBytes, type UiActionAt } from '@openagt/ui/module'
import { FolderX } from 'lucide-react'
import { server } from './calls.js'
import { CopyRepos } from './CopyRepos.js'
import { CopyRows } from './CopyRows.js'
import { handoffActions } from './handoff.js'
import { ProjectRow } from './ProjectRow.js'
import { ReposControl } from './ReposControl.js'
import { StartControl } from './StartControl.js'

/** The sentence a level adds to the prompt, every level starting with the commit. */
const COMMIT_OPENING = 'When you finish, if you changed any file, commit your work'

/**
 * Remove the checkout a finished run kept, beside its size on disk: only what is committed may
 * go, and its branch stays. Not offered while the run works, nor for a run with no checkout left.
 */
const removeWorktree: UiActionAt<'chat.menu'> = {
  place: 'chat.menu',
  id: 'remove-worktree',
  label: 'Remove worktree',
  busyLabel: 'Removing…',
  icon: FolderX,
  order: 80,
  async offer(host, on) {
    const kept = await server(host).checkout(on.projectId, { agentId: on.agentId })
    if (!kept.kept) return undefined
    const size = formatBytes(kept.sizeBytes, '')
    return size ? { note: size, title: `Its checkout takes ${size} on disk` } : {}
  },
  run: (host, on) => server(host).removeCheckout(on.projectId, { agentId: on.agentId }),
}

/** Bring the project's folder up to its remote's main branch: the fix of the item that says it is behind. */
const updateFolder: UiActionAt<'attention.fix'> = {
  place: 'attention.fix',
  id: 'update-folder',
  label: 'Update folder',
  busyLabel: 'Updating…',
  run: async (host, on) => (on.projectId === undefined ? { ok: false, error: 'No project to update.' } : server(host).updateProjectFolder(on.projectId, {})),
}

export default defineUiModule({
  name: 'git-branches',
  hooks: {
    'ui.view': [
      { place: 'chat.work', id: 'project', order: 10, View: ProjectRow },
      { place: 'chat.work', id: 'copies', order: 20, View: CopyRows },
      { place: 'chat.environment', id: 'copies', order: 20, View: CopyRepos },
      { place: 'composer.control', id: 'repos', at: 'context', order: 20, View: ReposControl },
      { place: 'composer.control', id: 'start-from', at: 'context', order: 30, View: StartControl },
    ],
    'ui.action': [...handoffActions, removeWorktree, updateFolder],
    'ui.option': [
      { place: 'composer.auto', id: 'commit', order: 10, label: 'Commit', description: 'It commits its work on its branch.', sentence: `${COMMIT_OPENING}.` },
      {
        place: 'composer.auto',
        id: 'branch',
        order: 20,
        label: 'Publish branch',
        description: 'It commits and pushes its branch.',
        sentence: `${COMMIT_OPENING}, push your branch and open no pull request.`,
        // Without a remote nothing can be published; a session with no project publishes its copies, wherever each is.
        offered: project => project === undefined || project.remote !== undefined,
      },
    ],
  },
})
