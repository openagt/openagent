import { useContext } from 'react'
import { moduleHost } from '../module/index.js'
import { HostServicesContext, INERT_HOST_SERVICES } from './host-services.js'
import { dataLinkParts } from './data-link.js'
import { useMountedModules } from './use-modules.js'
import { usePolled } from './use-async.js'

// What the paths into a project's files that a page shows are called. A queue entry may name
// `tickets/2026-01-01_x.md`; the page that shows the entry knows nothing of tickets, and a file
// path is no name a person reads. By the link convention (`data-link.ts`) the path's first segment
// names the page that opens it, so that page's module is asked for the name (`ModulePage.names`),
// and the dashboard, which installed both, puts the two together.

/** A path that has a name: what to show for it, and how to open it. */
export interface NamedFile {
  title: string
  /** Open the page that shows it. */
  open(): void
  /** The ask for what it names, word for word, once it is there already: an entry saying just this is left over, and reads as this `title`. */
  done?: { ask: string; title: string }
}

/** The name of a path into a project's files; `undefined` for one no installed page names. */
export type FileNames = (projectId: string, path: string) => NamedFile | undefined

/**
 * The paths into a project's files a text names: each run of characters with a slash in it whose
 * first segment could be a page's (`tickets/2026-01-01_x.md`), without the brackets or the stop
 * around it. Never a piece of something longer: a web address and an absolute path name no file
 * of the project.
 */
export function pathsIn(text: string): string[] {
  const found = text.match(/(?<![\w./:@-])[a-z][a-z0-9]*\/[^\s()[\]<>"'`]+/g) ?? []
  return [...new Set(found.map(path => path.replace(/[.,;:!?]+$/, '')).filter(path => dataLinkParts(path) !== undefined))]
}

/** A name as read: what to show, the path it opens, and the ask it answers once it is there already. */
interface ReadName {
  title: string
  href: string
  done?: { ask: string; title: string }
}

const NOTHING: Record<string, ReadName> = {}

/**
 * The names of the paths asked about, per project, read once a minute. A path whose page is not
 * installed in that project, or does not name it, has no name. The names are kept under `remember`
 * for the next visit, as the list the paths come from is: they show from the first frame.
 */
export function useFileNames(asked: readonly { projectId: string; paths: readonly string[] }[], remember: string): FileNames {
  const { pages, loaded: mounted } = useMountedModules()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const key = asked.map(({ projectId, paths }) => `${projectId}\n${[...paths].sort().join('\n')}`).join('\n\n')
  const naming = pages.filter(page => page.names !== undefined)
  const { value: names } = usePolled<Record<string, ReadName>>(
    async () => {
      // Which pages name paths is not known before every module is in: no answer yet, so the names kept stand.
      if (!mounted) throw new Error('the modules are not in yet')
      const named: Record<string, ReadName> = {}
      await Promise.all(
        asked.flatMap(({ projectId, paths }) =>
          naming
            .filter(page => page.projects.includes(projectId))
            .map(async page => {
              const own = paths.filter(path => dataLinkParts(path)?.segment === page.segment)
              if (own.length === 0) return
              const answer = await page.names!(moduleHost({ ...services, package: page.package }), projectId, own).catch(() => ({}))
              for (const path of own) {
                const name = (answer as Record<string, { title?: unknown; href?: unknown; done?: { ask?: unknown; title?: unknown } | null } | undefined>)[path]
                const done = name?.done
                if (name && typeof name.title === 'string' && name.title.trim() !== '') named[`${projectId}\n${path}`] = { title: name.title, href: typeof name.href === 'string' ? name.href : path, ...(typeof done?.ask === 'string' && typeof done.title === 'string' ? { done: { ask: done.ask, title: done.title } } : {}) }
              }
            }),
        ),
      )
      return named
    },
    NOTHING,
    60_000,
    [key, naming.map(page => page.package).join(','), mounted],
    // One key for every set of paths: an entry added or removed does not turn every title back into a path for a moment.
    { remember, stored: true },
  )
  return (projectId, path) => {
    const name = names[`${projectId}\n${path}`]
    const parts = name && dataLinkParts(name.href)
    return name && parts ? { title: name.title, open: () => services.openPage(parts.segment, parts.rest, projectId), ...(name.done !== undefined ? { done: name.done } : {}) } : undefined
  }
}
