import { ownRunsWatch } from '../dashboard/runs-watch.js'
import { onPrMoved } from '../dashboard/pr-states.js'
import { contextProjects } from './context.js'
import { SESSIONS_ID } from '../project-address.js'

// What the page is told the moment it should read the runs again (`GET /_rpc/changes`): a run of
// one of the projects, or a session with no project, changed; or a pull request stands otherwise,
// which every place that shows one reads again together, the rows of the runs with the run's own page.
// The page reads the list itself, as it always does; this only says when, so it reads at once
// instead of at its next poll.

/** One thing the page is told: the runs of the project changed, or a pull request moved (merged, closed, opened). */
export type RunsChanged = { kind: 'runs'; projectId: string } | { kind: 'prs' }

/** How often the projects are listed again while a page listens: a project added since is followed too. */
const PROJECTS_EVERY_MS = 30_000
/** Changes that come together are told once: a run that ends changes its card, then its record. */
const TOGETHER_MS = 200

/** Tell `send` each time the runs of a project on the list change, until the answer is called. */
export function followRunsChanged(send: (change: RunsChanged) => void): () => void {
  const followed = new Map<string, { path: string; stop: () => void }>()
  const told = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false
  const later = (key: string, change: RunsChanged): void => {
    if (stopped || told.has(key)) return
    told.set(
      key,
      setTimeout(() => {
        told.delete(key)
        if (!stopped) send(change)
      }, TOGETHER_MS),
    )
  }
  const tell = (projectId: string): void => later(`runs:${projectId}`, { kind: 'runs', projectId })
  const stopPrs = onPrMoved(() => later('prs', { kind: 'prs' }))
  const follow = async (): Promise<void> => {
    const [own, sessions] = await Promise.all([
      contextProjects()
        .list()
        .catch(() => undefined),
      contextProjects()
        .resolvePath(SESSIONS_ID)
        .catch(() => undefined),
    ])
    if (stopped || own === undefined) return
    // The sessions with no project are followed as a project's runs are, in their home.
    const projects: { id: string; path: string }[] = [...own, ...(sessions !== undefined ? [{ id: SESSIONS_ID, path: sessions }] : [])]
    const paths = new Map(projects.map(project => [project.id, project.path]))
    for (const [id, one] of followed) {
      if (paths.get(id) === one.path) continue
      one.stop()
      followed.delete(id)
    }
    for (const project of projects) {
      if (followed.has(project.id)) continue
      followed.set(project.id, { path: project.path, stop: ownRunsWatch.follow(project.path, () => tell(project.id)) })
    }
  }
  void follow()
  const timer = setInterval(() => void follow(), PROJECTS_EVERY_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
    stopPrs()
    for (const one of followed.values()) one.stop()
    followed.clear()
    for (const timeout of told.values()) clearTimeout(timeout)
    told.clear()
  }
}
