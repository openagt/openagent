import { useContext } from 'react'
import { moduleHost, type UiPrompt } from '../module/index.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { HostServicesContext, INERT_HOST_SERVICES } from './host-services.js'
import { usePolled } from './use-async.js'
import { useMountedModules, type MountedView } from './use-modules.js'

// The prompts a person saved, as the message box offers them (#2394): what the modules at
// `composer.prompts` list in the box's project, which its `/` menu and its Commands menu load into
// the box, and the panel that saves what the box holds as one. The shell names no module: with
// none there, the box offers no saved prompt and no way to save one.

/** A prompt the box offers, with the package of the module that offers it. */
export type OfferedPrompt = UiPrompt & { package: string }

/** The saved prompts of the box in one project. */
export interface Prompts {
  /** What the modules offer: each module's in its own order, the modules in theirs. */
  list: OfferedPrompt[]
  /** Delete one, through the module that offers it, then read them again. */
  remove(prompt: OfferedPrompt): Promise<void>
  /** The panel that saves what the box holds as a prompt: the first module's. None where no module offers one. */
  saver: MountedView<'composer.prompts'> | undefined
  /** Read them again now: one was saved. */
  reload(): void
}

const NONE: OfferedPrompt[] = []

/**
 * The saved prompts of the box in project `projectId` ({@link SESSIONS_ID} for a session with no
 * project, none for no box): read once a minute and as the tab is shown again, and kept under the
 * project, so the next box of the project shows them from its first frame.
 */
export function usePrompts(projectId: string | null): Prompts {
  const { views } = useMountedModules()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const offering = projectId === null ? [] : views['composer.prompts'].filter(entry => entry.projects.includes(projectId) || (projectId === SESSIONS_ID && entry.sessions === true))
  const hostOf = (entry: MountedView<'composer.prompts'>) => moduleHost({ ...services, package: entry.package })
  const { value, reload } = usePolled<OfferedPrompt[]>(
    projectId === null || offering.length === 0
      ? null
      : async () => (await Promise.all(offering.map(async entry => (await entry.list(hostOf(entry), projectId)).map(prompt => ({ ...prompt, package: entry.package }))))).flat(),
    NONE,
    60_000,
    [projectId, offering.map(entry => `${entry.package}/${entry.id}`).join(' ')],
    { remember: `prompts ${projectId}` },
  )
  return {
    list: offering.length === 0 ? NONE : value,
    async remove(prompt) {
      const entry = offering.find(each => each.package === prompt.package)
      if (!entry || projectId === null) return
      await entry.remove(hostOf(entry), projectId, prompt.id)
      await reload()
    },
    saver: offering[0],
    reload: () => void reload(),
  }
}
