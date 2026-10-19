import { useState } from 'react'
import { Check, ChevronsUpDown, Layers, Plus } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { cn } from '../lib/utils.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { projectErrorTitle } from './ProjectErrorBanner.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu.js'

/** A project's state as a dot: red when the daemon recorded an error for it (#1500), else whether it is activated. */
function ProjectDot({ project }: { project: ProjectSummary }) {
  return (
    <span
      aria-hidden
      className={cn('h-2 w-2 shrink-0 rounded-full', project.errors?.length ? 'bg-danger' : project.activated ? 'bg-primary' : 'bg-muted-foreground')}
    />
  )
}

/** A project's name, after the folders that tell it from another of the same name, muted, so the names line up. */
function ProjectName({ name, label }: { name: string; label: string }) {
  const folders = label.endsWith(name) ? label.slice(0, -name.length) : ''
  return (
    <span className="block truncate">
      {folders && <span className="text-muted-foreground">{folders}</span>}
      {folders ? name : label}
    </span>
  )
}

// The project every page shows (#1513): one project, or all of them. It sits at the very top of the
// sidebar, under the brand, because what it picks applies to every page below it: the Overview, the
// modules' pages and the list of recent agents. It filters; it does not navigate.
export function ProjectSelect({
  projects,
  scope,
  pending = false,
  onScope,
  onProjectAdded,
}: {
  projects: ProjectSummary[]
  /** The one project every page shows, or null for all of them. */
  scope: string | null
  /** The address names a project the dashboard has not read yet: which one it is, or whether it is one, is not known. */
  pending?: boolean
  onScope: (projectId: string | null) => void
  onProjectAdded?: (() => void) | undefined
}) {
  const [adding, setAdding] = useState<'folder' | 'address' | null>(null)
  const label = useProjectLabel()
  const selected = scope === null ? undefined : projects.find(p => p.id === scope)
  const named = selected ? label(selected.id, selected.name) : 'All projects'
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Project: ${pending ? 'loading' : named}`}
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2 py-1.5 text-sm font-medium transition-colors hover:bg-sidebar-accent/60"
        >
          {/* Until the projects are read, the project the address names is not known: a bar where its
              name goes, rather than "All projects" for a moment. */}
          {pending ? (
            <>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-muted" />
              <span className="flex-1">
                <span aria-hidden className="block h-3.5 w-24 animate-pulse rounded bg-muted" />
              </span>
            </>
          ) : (
            <>
              {selected ? <ProjectDot project={selected} /> : <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="flex-1 truncate text-left">{named}</span>
            </>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        </DropdownMenuTrigger>
        {/* As wide as the button it drops from. */}
        <DropdownMenuContent align="start" className="w-[var(--anchor-width)]">
          <DropdownMenuItem onClick={() => onScope(null)}>
            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">All projects</span>
            {scope === null && <Check className="h-3.5 w-3.5 shrink-0" aria-label="selected" />}
          </DropdownMenuItem>
          {projects.length > 0 && <DropdownMenuSeparator />}
          {projects.map(p => (
            <DropdownMenuItem key={p.id} onClick={() => onScope(p.id)}>
              <ProjectDot project={p} />
              <span className="min-w-0 flex-1">
                <ProjectName name={p.name} label={label(p.id, p.name)} />
                {/* What the daemon finds wrong with it, in words: the project's own page carries the detail. */}
                {p.errors?.map(e => (
                  <span key={e.code} title={e.message} className="block truncate text-xs text-danger">
                    {projectErrorTitle(e.code)}
                  </span>
                ))}
                {!p.errors?.length && !p.activated && <span className="block text-xs text-muted-foreground">Not activated</span>}
                {/* Nothing wrong: the repository has no remote, or the person keeps the agents' records here. */}
                {!p.errors?.length && p.activated && p.local && (
                  <span className="block text-xs text-muted-foreground">{p.local === 'no-remote' ? 'Local only, no remote' : 'Records kept on this machine'}</span>
                )}
              </span>
              {p.id === scope && <Check className="h-3.5 w-3.5 shrink-0" aria-label="selected" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAdding('folder')} className="text-muted-foreground">
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Add project</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAdding('address')} className="text-muted-foreground">
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Add from a GitHub address</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {adding && <AddProjectPanel fromAddress={adding === 'address'} onAdded={() => onProjectAdded?.()} onClose={() => setAdding(null)} />}
    </>
  )
}
