import type { ProjectSummary } from '../../src/index.js'
import { onProjects } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { ContextFiles } from './ContextFiles.js'
import { ReposMenu, SessionReposSaid, folderName } from './SessionRepos.js'

/** Whether a path of the Context is a folder on this computer, a repo's, and not a file of the project's, which is said from the project's root. */
export function isRepoPath(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/])/.test(path)
}

/** The files of a project's Context, listed to be removed, or how to add one. */
function contextFiles(files: string[], busy: boolean, onRemove: (path: string) => void) {
  return {
    count: files.length,
    list:
      files.length > 0 ? (
        <div className="px-2 py-1">
          <ContextFiles files={files} onRemove={onRemove} busy={busy} />
        </div>
      ) : (
        <p className="px-2 py-1 text-xs text-muted-foreground">None yet — add with # or the Files pane.</p>
      ),
  }
}

/**
 * The Context picker of a project's launcher: the menu a session with no project has (ReposMenu),
 * with the files a `#` mention or the file tree added over its repos. The Context mixes repos
 * (their folders on this computer, a project's or one that is none) and single files (paths in
 * the project). A tick on a repo does what it does with no project: the run copies the repo into
 * the session's folder, and the repo's own folder is left as it was (before, the agent was
 * pointed at the folder itself, and worked in the person's own checkout). The files are listed to
 * be removed; and each kind is counted on the button. The current project is the run's own
 * checkout, so it is not offered (#665).
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
      files={contextFiles(files, busy, onToggle)}
    />
  )
}

/**
 * The Context of a session in a project, on its own page: the repos it started with, said and
 * not offered, as a session with no project has them (a session keeps its copies), and the
 * files picked for the next message, which go with it as the line at its end.
 */
export function SessionContextMenu({ repos, context, busy, onToggle }: { repos: readonly { name: string; from: string }[]; context: Set<string>; busy: boolean; onToggle: (path: string) => void }) {
  return <SessionReposSaid repos={repos} files={contextFiles([...context].filter(path => !isRepoPath(path)), busy, onToggle)} />
}
