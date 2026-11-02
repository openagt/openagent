import { useRef } from 'react'
import { onCommands, type ProjectLauncher } from '../rpc/projects.js'
import { usePolled } from './use-async.js'
import { usePreferences } from './preferences.js'

/**
 * What the launcher offers for a project: its commands, and whether it has a start hook. `null`
 * until it is read, and for no project: a surface says "no start hook" only once it knows. Read
 * again every few seconds: a skill written into the project's folder, here or in a terminal, is a
 * command from then on, and one that reached the branch agents start from stops waiting.
 *
 * A command is waiting for the branch the person starts agents from, so the read names their pick.
 * A new pick is read at once; the project's last answer stands until it lands, since what the
 * launcher shows of it does not hang on the pick.
 */
export function useProjectLauncher(projectId: string | null): ProjectLauncher | null {
  const pick = usePreferences().startFrom?.[projectId ?? '']
  const read = usePolled<ProjectLauncher | null>(projectId ? () => (pick ? onCommands(projectId, pick) : onCommands(projectId)) : null, null, 15_000, [projectId, pick?.kind, pick?.kind === 'published' ? pick.branch : undefined])
  const last = useRef<{ projectId: string | null; launcher: ProjectLauncher | null }>({ projectId, launcher: null })
  if (read.loaded) last.current = { projectId, launcher: read.value }
  return read.loaded || last.current.projectId !== projectId ? read.value : last.current.launcher
}

/** The commands an agent started now has: the ones not waiting to reach the branch it starts from. */
export function readyCommands<T extends { waiting?: string | undefined }>(commands: readonly T[]): T[] {
  return commands.filter(command => command.waiting === undefined)
}
