import type { AttentionRead, ProjectRef, RunOptions } from '@openagt/hooks'
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
  return hooks.attention({ ...(project ? { project } : {}), ...(options !== undefined ? { options } : {}) })
}
