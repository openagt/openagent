import { ChevronRight, Folder } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { useProjectLabel } from '../lib/project-labels.js'

/**
 * A project's own Settings page with every project picked: it is about one project at a time, so
 * it asks for one. `words` says why, in the page's own terms.
 */
export function PickProject({ words, projects, onPick }: { words: string; projects: ProjectSummary[]; onPick: (id: string) => void }) {
  const label = useProjectLabel()
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{words}</p>
      <ul className="divide-y divide-border">
        {projects.map(project => (
          <li key={project.id}>
            <button type="button" onClick={() => onPick(project.id)} className="flex w-full min-w-0 items-center gap-3 rounded py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
              <Folder aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{label(project.id, project.name)}</span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
