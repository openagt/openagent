import { useMemo } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown, Layers, Search } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { cn } from '../lib/utils.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Skeleton, useSkeleton } from './ui/skeleton.js'
import { MENU_BODY_CLASS, MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS, MenuMark } from './ui/dropdown-menu.js'
import { PROJECT_ROW_CLASS } from './ui/nav-row.js'
import { usePopupPosition } from './ui/popup-placement.js'
import { usePickerSearch } from './ui/picker-search.js'

/** A row of the menu: every project, or one of them. */
interface Row {
  value: string
  label: string
  project?: ProjectSummary
  /** What the search matches besides the label. */
  search: string
}

const ALL: Row = { value: 'all', label: 'All projects', search: '' }

const sameRow = (a: Row, b: Row): boolean => a.value === b.value

/** A project's state as a dot: red when a module says something needs fixing there (#1500). */
export function ProjectDot({ project }: { project: ProjectSummary }) {
  return <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', project.errors?.length ? 'bg-danger' : 'bg-primary')} />
}

/** A project's row: its dot, its name, and under it what is wrong with it, or what the modules note of it. */
function ProjectLine({ project, label }: { project: ProjectSummary; label: string }) {
  const folders = label.endsWith(project.name) ? label.slice(0, -project.name.length) : ''
  return (
    <>
      <MenuMark className="w-3.5 justify-center">
        <ProjectDot project={project} />
      </MenuMark>
      <span className="min-w-0 flex-1 leading-5">
        {/* Its name after the folders that tell it from another of the same name, muted, so the names line up. */}
        <span className="block truncate">
          {folders && <span className="text-muted-foreground">{folders}</span>}
          {folders ? project.name : label}
        </span>
        {project.errors?.map(e => (
          <span key={e.id} data-line2 title={e.message} className="block truncate text-xs leading-4 text-danger">
            {e.title}
          </span>
        ))}
        {!project.errors?.length &&
          project.notes?.map(note => (
            <span key={note.id} data-line2 className="block truncate text-xs leading-4 text-muted-foreground">
              {note.words}
            </span>
          ))}
      </span>
    </>
  )
}

// The project every page shows, at the top of the sidebar (#1513): every project, or one, picked
// from a menu that lists them, searchable by name and folder. A project is added in the launcher's
// picker of where a session works, or from the Overview's first steps: the projects module's.
export function SidebarProjectPicker({
  picked,
  pending = false,
  projects,
  onPick,
}: {
  /** The project picked, or null for every one. */
  picked: string | null
  /** The project the address names is not read yet: a bar where its name goes. */
  pending?: boolean
  projects: readonly ProjectSummary[]
  onPick: (projectId: string | null) => void
}) {
  const label = useProjectLabel()
  const position = usePopupPosition()
  const search = usePickerSearch()
  const loading = useSkeleton(pending)
  const rows = useMemo<Row[]>(() => projects.map(project => ({ value: `project:${project.id}`, label: label(project.id, project.name), project, search: project.path })), [projects, label])
  const query = search.typed.trim().toLowerCase()
  const shownRows = [ALL, ...rows].filter(row => !query || `${row.label}\n${row.search}`.toLowerCase().includes(query))
  const current = picked === null ? ALL : (rows.find(row => row.value === `project:${picked}`) ?? { value: `project:${picked}`, label: '', search: '' })
  const shown = current.label
  // No project word until the name is known, never a wrong one.
  if (!shown && !pending) return null
  const name = `Project: ${pending ? 'loading' : shown}`
  const button = (
    // A card on the sidebar, as high whatever it shows, so the rows under it never move: the chevrons say it opens.
    <button type="button" className={PROJECT_ROW_CLASS}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {pending ? null : current.project ? <ProjectDot project={current.project} /> : <Layers className="size-4 text-muted-foreground" aria-hidden />}
      </span>
      {/* Until the projects are read, the project the address names is not known: a bar where its name goes, rather than "All projects" for a moment. */}
      {loading ? <Skeleton className="h-4 w-24" /> : <span className="flex-1 truncate text-left">{pending ? '' : shown}</span>}
      <ChevronsUpDown className="ml-auto" aria-hidden />
    </button>
  )
  return (
    <Combobox.Root<Row>
      items={shownRows}
      filteredItems={shownRows}
      value={current}
      isItemEqualToValue={sameRow}
      itemToStringLabel={row => row.label}
      autoHighlight
      {...search.root}
      onValueChange={row => row && onPick(row.project?.id ?? null)}
    >
      <Combobox.Trigger disabled={pending} aria-label={name} className={MENU_TRIGGER_OPEN_CLASS} render={button} {...search.trigger} data-project-picker="" />
      <Combobox.Portal>
        <Combobox.Positioner {...position} sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup data-overlay="picker" aria-label={name} className={cn(MENU_POPUP_CLASS, 'w-[22rem] max-w-[var(--available-width)]')}>
            {/* The field one line tall, 16 in from the band's every edge, as the jump's is. */}
            <div className="flex h-13 items-center gap-3 border-b border-hairline px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input aria-label="Search projects" placeholder="Search projects" className="h-5 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <ScrollArea viewportClassName="max-h-[min(20rem,calc(var(--available-height)-5rem))]">
              <div className={MENU_BODY_CLASS}>
                <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">No project by that name.</Combobox.Empty>
                <Combobox.List>
                  {(row: Row) => (
                    <Combobox.Item key={row.value} value={row} className={MENU_ITEM_CLASS}>
                      {row.project ? (
                        <ProjectLine project={row.project} label={row.label} />
                      ) : (
                        <>
                          <MenuMark>
                            <Layers className="size-3.5 text-muted-foreground" aria-hidden />
                          </MenuMark>
                          <span className="min-w-0 flex-1 truncate leading-5">{row.label}</span>
                        </>
                      )}
                      {row.value === current.value && (
                        <MenuMark>
                          <Check className="size-3.5" aria-hidden />
                        </MenuMark>
                      )}
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </div>
            </ScrollArea>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
