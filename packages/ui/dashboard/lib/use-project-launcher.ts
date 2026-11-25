import { useRef } from 'react'
import { onCommands, type ProjectLauncher } from '../rpc/projects.js'
import { usePolled } from './use-async.js'

/**
 * What the launcher offers for a project: the branches an agent can start from, and how far a run
 * can publish. `null` until it is read, and for no project. Read again every few seconds; the
 * project's last answer stands while it is read again, and another project's is never shown for it.
 */
export function useProjectLauncher(projectId: string | null): ProjectLauncher | null {
  const read = usePolled<ProjectLauncher | null>(projectId ? () => onCommands(projectId) : null, null, 15_000, [projectId])
  const last = useRef<{ projectId: string | null; launcher: ProjectLauncher | null }>({ projectId, launcher: null })
  const known = read.state !== 'unknown'
  if (known) last.current = { projectId, launcher: read.value }
  return known || last.current.projectId !== projectId ? read.value : last.current.launcher
}
