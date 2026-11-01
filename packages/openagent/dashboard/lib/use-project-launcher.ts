import { onCommands, type ProjectLauncher } from '../rpc/projects.js'
import { usePolled } from './use-async.js'
import { usePreferences } from './preferences.js'

/**
 * What the launcher offers for a project: its commands, and whether it has a start hook. `null`
 * until it is read, and for no project: a surface says "no start hook" only once it knows. Read
 * again every few seconds: a skill written into the project's folder, here or in a terminal, is a
 * command from then on, and one that reached the branch agents start from stops waiting.
 *
 * A command is waiting for the branch the person starts agents from: where they picked the
 * folder's own branch as the start, a skill that branch already has is not waiting.
 */
export function useProjectLauncher(projectId: string | null): ProjectLauncher | null {
  const launcher = usePolled<ProjectLauncher | null>(projectId ? () => onCommands(projectId) : null, null, 15_000, [projectId]).value
  const fromHere = usePreferences().startFrom?.[projectId ?? ''] === 'local'
  if (!launcher || !fromHere || !launcher.startFrom) return launcher
  return { ...launcher, commands: launcher.commands.map(({ waiting, here, ...command }) => (here ? command : { ...command, ...(waiting !== undefined ? { waiting } : {}) })) }
}

/** The commands an agent started now has: the ones not waiting to reach the branch it starts from. */
export function readyCommands<T extends { waiting?: string | undefined }>(commands: readonly T[]): T[] {
  return commands.filter(command => command.waiting === undefined)
}
