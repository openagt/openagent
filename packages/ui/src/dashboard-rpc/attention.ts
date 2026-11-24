import type { AttentionRead, ProjectRef, RunOptions } from '@openagt/hooks'
import { refreshLoginShellPath } from '../shell-path.js'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'
import { resolveProjectPath } from './context.js'

// What needs the person (#2394, `app.attention`), as the shell draws it in its own chrome: the
// onboarding card, the line above the message box, the person's menu and the dot on their
// picture. The shell says none of it itself: each module on says its own.

/**
 * What every module on says needs the person: about this computer, and with a project, about it,
 * for the run options picked in its launcher. A project not known here is asked about as none.
 */
export async function onAttention(projectId: string | null, options?: RunOptions): Promise<AttentionRead> {
  const hooks = await distributionHooks()
  let project: ProjectRef | undefined
  if (projectId !== null && projectId !== SESSIONS_ID) {
    const cwd = await resolveProjectPath(projectId)
    if (cwd) project = await projectRefAt(projectId, cwd)
  }
  const read = await hooks.attention({ ...(project ? { project } : {}), ...(options !== undefined ? { options } : {}) })
  // Something to set up may be a program the person installed since OpenAgent started, or one only
  // their terminal's PATH has: the PATH is read again from their login shell, so the next read finds it.
  if (read.items.some(item => item.kind === 'setup')) void refreshLoginShellPath()
  return read
}
