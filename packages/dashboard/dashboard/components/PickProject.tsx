import { ChevronRight, Folder } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { List, Row } from './ui/list.js'

/**
 * A project's own Settings page with every project picked: it is about one project at a time, so
 * it asks for one. `words` says why, in the page's own terms.
 */
export function PickProject({ words, projects, onPick }: { words: string; projects: ProjectSummary[]; onPick: (id: string) => void }) {
  const label = useProjectLabel()
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{words}</p>
      <List>
        {projects.map(project => (
          <Row
            key={project.id}
            leading={<Folder aria-hidden className="size-4" />}
            title={label(project.id, project.name)}
            meta={<ChevronRight aria-hidden className="size-4" />}
            onClick={() => onPick(project.id)}
          />
        ))}
      </List>
    </div>
  )
}
