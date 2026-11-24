// git-branches' UI part: the package's `./dashboard` export. What an ended session's branch holds,
// in the bar above its message box (`chat.summary`), "Committing…" there while the agent does what
// its Commit press asked, and its next steps there (`chat.handoff`):
// Commit, Publish branch, Merge on this machine, a copy's work brought back to its folder, and
// uncommitted work discarded; a row per copy of a repo the session holds work in (`chat.work`);
// Remove worktree in the session's menu (`chat.menu`); the branch a run starts from, in the row
// above the box (`composer.control` at `start`); the Auto menu's Commit and Publish branch
// (`composer.auto`); and the press that brings a project's folder up to its remote
// (`attention.fix`), for the item its Node part says. What it reads and does is its own server
// part's (`../src/server.ts`).
import { defineUiModule, formatBytes, type UiActionAt } from '@openagt/ui/module'
import { FolderX } from 'lucide-react'
import { server } from './calls.js'
import { Committing } from './Committing.js'
import { CopyRows } from './CopyRows.js'
import { handoffActions } from './handoff.js'
import { RunSummary } from './HandoffSummary.js'
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
      { place: 'chat.summary', id: 'committing', View: Committing },
      { place: 'chat.summary', id: 'branch', ended: true, View: RunSummary },
      { place: 'chat.work', id: 'copies', View: CopyRows },
      { place: 'composer.control', id: 'start-from', at: 'start', order: 10, View: StartControl },
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
