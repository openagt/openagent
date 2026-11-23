import type { ProjectSummary } from '../../src/index.js'
import { onProjects } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { ContextFiles } from './ContextFiles.js'
import { ReposMenu, folderName } from './SessionRepos.js'

/** Whether a path of the Context is a folder on this computer, a repo's, and not a file of the project's, which is said from the project's root. */
export function isRepoPath(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/])/.test(path)
}

/**
 * The Context picker of one project's box, the launcher's and a session's alike: the menu a
 * session with no project has (ReposMenu), with the files a `#` mention or the file tree added
 * over its repos. The Context mixes repos (their folders on this computer, a project's or one
 * that is none) and single files (paths in the project): a tick on a repo points the agent at it
 * where it is, which narrows its focus and copies nothing, and the menu's heading says so; the
 * files are listed to be removed; and each kind is counted on the button. The current project is
 * the run's own checkout, so it is not offered (#665).
 */
export function ProjectContextMenu({ projectId, context, busy, onToggle }: { projectId: string; context: Set<string>; busy: boolean; onToggle: (path: string) => void }) {
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const picked = [...context].filter(isRepoPath).map(path => ({ path, name: folderName(path) }))
  const files = [...context].filter(path => !isRepoPath(path))
  return (
    <ReposMenu
      picked={picked}
      projects={projects}
      without={projects.find(project => project.id === projectId)?.path}
      busy={busy}
      // The menu says the whole pick; the Context is told each repo that came or went.
      onChange={next => {
        for (const repo of picked) if (!next.some(one => one.path === repo.path)) onToggle(repo.path)
        for (const repo of next) if (!context.has(repo.path)) onToggle(repo.path)
      }}
      heading="Repos the agent is pointed at, where they are: it can still reach every repo"
      said={names => (names.length === 0 ? 'Narrow the run to specific repos and files' : `The agent is pointed at ${names.join(', ')}`)}
      files={{
        count: files.length,
        list:
          files.length > 0 ? (
            <div className="px-2 py-1">
              <ContextFiles files={files} onRemove={onToggle} busy={busy} />
            </div>
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground">None yet — add with # or the Files pane.</p>
          ),
      }}
    />
  )
}
