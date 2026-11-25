import { useContext } from 'react'
import { moduleHost, type UiCommand } from '../module/index.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { HostServicesContext, INERT_HOST_SERVICES } from './host-services.js'
import { usePolled } from './use-async.js'
import { useMountedModules } from './use-modules.js'

// The commands the message box offers (#2394): what the modules at `composer.commands` list in the
// box's project, which its `/` menu and its Commands menu put in the box. The shell names no
// module: with none there, the box offers no command.

const NONE: UiCommand[] = []

/**
 * The commands of the box in project `projectId`: none for a session with no project
 * ({@link SESSIONS_ID}) or no box. Read every few seconds: a skill written into the project's
 * folder, here or in a terminal, is a command from then on, and one that reached the branch agents
 * start from stops waiting. Each module's in its own order, the modules in theirs.
 */
export function useCommands(projectId: string | null): UiCommand[] {
  const { options } = useMountedModules()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const offering = projectId === null || projectId === SESSIONS_ID ? [] : options['composer.commands'].filter(entry => entry.computer === true || entry.projects.includes(projectId))
  const { value } = usePolled<UiCommand[]>(
    projectId === null || offering.length === 0
      ? null
      : async () => (await Promise.all(offering.map(entry => entry.list(moduleHost({ ...services, package: entry.package }), projectId).catch(() => NONE)))).flat(),
    NONE,
    15_000,
    [projectId, offering.map(entry => `${entry.package}/${entry.id}`).join(' ')],
    { remember: `commands ${projectId}` },
  )
  return offering.length === 0 ? NONE : value
}

/** The commands an agent started now has: the ones not waiting to reach the branch it starts from. */
export function readyCommands<T extends { waiting?: string | undefined }>(commands: readonly T[]): T[] {
  return commands.filter(command => command.waiting === undefined)
}
