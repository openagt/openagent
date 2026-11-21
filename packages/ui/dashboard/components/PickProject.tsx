import { ChevronRight, Folder } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { SettingsItem, SettingsItems } from './SettingsRows.js'

/**
 * A project's own Settings page with every project picked: it is about one project at a time, so
 * it asks for one. `words` says why, in the page's own terms.
 */
export function PickProject({ words, projects, onPick }: { words: string; projects: ProjectSummary[]; onPick: (id: string) => void }) {
  const label = useProjectLabel()
  return (
    <div className="space-y-6">
      <p className="max-w-md text-sm text-muted-foreground">{words}</p>
      <SettingsItems>
        {projects.map(project => (
          <SettingsItem key={project.id} icon={Folder} title={label(project.id, project.name)} end={<ChevronRight aria-hidden />} onClick={() => onPick(project.id)} />
        ))}
      </SettingsItems>
    </div>
  )
}
