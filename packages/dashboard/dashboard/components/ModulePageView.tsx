import { Component, useMemo, type ReactNode } from 'react'
import type { ProjectSummary } from '../../src/index.js'
import { ModuleHostContext, moduleHost, type ModuleProject } from '../module/index.js'
import type { MountedPage } from '../lib/use-modules.js'
import { useHostServices } from '../lib/host-services.js'

/** A module's piece that throws shows this instead of taking the whole dashboard down. */
class ModuleBoundary extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <div role="alert" className="p-6 text-sm text-danger">
        The {this.props.label} failed: {this.state.error}
      </div>
    )
  }
}

/**
 * Where one module's piece renders (#1774/#1818): inside the host context its `useModuleHost`
 * reads (its package, the shell's services), and inside a boundary, so a broken module breaks
 * only its own piece. The page view and the Overview's cards both render through it. `label`
 * names the piece in the boundary's line: "Logs page", "queue card".
 */
export function ModuleSlot({ package: pkg, label, children }: { package: string; label: string; children: ReactNode }) {
  const base = useHostServices(pkg)
  // The same host from render to render, so an effect keyed on it does not start over.
  const host = useMemo(() => moduleHost(base), [base])
  return (
    <ModuleHostContext.Provider value={host}>
      <ModuleBoundary label={label}>{children}</ModuleBoundary>
    </ModuleHostContext.Provider>
  )
}

/** The projects a module's piece is given: of the projects handed in (every registered one, or the picked one alone), the ones that have its package, by id and name, each with whether it has a git host package. Empty when none has it: the Overview then draws no card. */
export function projectsHaving(ids: readonly string[], projects: readonly ProjectSummary[]): ModuleProject[] {
  return ids.flatMap(id => {
    const project = projects.find(p => p.id === id)
    return project ? [{ id: project.id, name: project.name, gitHost: project.gitHost }] : []
  })
}

/** One module page in the main pane (#1774): the page, given the projects that have its package and the picked one, in its slot. */
export function ModulePageView({ page, projects, projectId, path }: { page: MountedPage; projects: ProjectSummary[]; projectId: string | null; path: string[] }) {
  const Page = page.Page
  return (
    <ModuleSlot key={page.segment} package={page.package} label={`${page.label} page`}>
      <Page projects={projectsHaving(page.projects, projects)} projectId={projectId} path={path} />
    </ModuleSlot>
  )
}
