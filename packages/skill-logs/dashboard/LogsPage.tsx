import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useModuleHost, usePolled, formatRelative, type ModulePageProps, type ModuleProject } from '@openagt/dashboard/module'
import type { RunCard } from '../src/run.js'

/** How many runs each project lists: the command's own default page is 20; the page shows more. */
const LIMIT = 50

/** One run, with the project it was recorded in. */
interface Row {
  project: ModuleProject
  card: Omit<RunCard, 'caller'>
}

/** What one read of every project gave: the runs, and the projects whose command failed, with why. */
interface Read {
  rows: Row[]
  failed: { project: ModuleProject; error: string }[]
}

const NOTHING_READ: Read = { rows: [], failed: [] }

const STATUS_CLASS: Record<string, string> = {
  running: 'text-primary',
  done: 'text-success',
  stopped: 'text-warning',
  failed: 'text-danger',
  waiting: 'text-info',
}

/**
 * The Logs page: every project's recorded runs, newest first, from `logs --limit 50` in each
 * project. A row opens the run's own page in the dashboard. A project whose command fails is named
 * with the command's own reason, and the other projects still show.
 */
export function LogsPage({ projects }: ModulePageProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: read, loaded } = usePolled<Read>(
    async () => {
      const results = await Promise.all(projects.map(async project => ({ project, result: await host.runCommand(project.id, ['--limit', String(LIMIT)]) })))
      const rows: Row[] = []
      const failed: Read['failed'] = []
      for (const { project, result } of results) {
        if (!result.ok) failed.push({ project, error: result.error })
        else if (Array.isArray(result.output)) for (const card of result.output as Row['card'][]) rows.push({ project, card })
        else failed.push({ project, error: 'the logs command did not print a list' })
      }
      rows.sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
      return { rows, failed }
    },
    NOTHING_READ,
    // Each read fetches origin's copy of the records branch, and a run lands only when it ends.
    60_000,
    [key],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 max-md:p-4">
      <h1 className="text-lg font-semibold">Logs</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every run recorded in {projects.length === 1 ? 'this project' : 'these projects'}, newest first.</p>
      {read.failed.map(({ project, error }) => (
        <p key={project.id} role="alert" className="mt-3 text-sm text-danger">
          Could not read the runs of {project.name}: {error}
        </p>
      ))}
      {loaded && read.rows.length === 0 && read.failed.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No runs recorded yet.</p>}
      {read.rows.length > 0 && (
        <div className="mt-4 max-md:hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Asked</TableHead>
                {projects.length > 1 && <TableHead>Project</TableHead>}
                <TableHead>Branch</TableHead>
                <TableHead>Pull request</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {read.rows.map(({ project, card }) => (
                <TableRow key={`${project.id}/${card.id}`} onClick={() => host.openAgent(project.id, card.id)} className="cursor-pointer">
                  <TableCell className={STATUS_CLASS[card.status] ?? 'text-muted-foreground'}>{card.status}</TableCell>
                  <TableCell className="max-w-md truncate" title={card.intent}>
                    {card.intent?.trim() || card.id}
                  </TableCell>
                  {projects.length > 1 && <TableCell className="text-muted-foreground">{project.name}</TableCell>}
                  <TableCell className="font-mono text-xs text-muted-foreground">{card.branch ?? '—'}</TableCell>
                  <TableCell>
                    {card.pr ? (
                      <a href={card.pr.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="text-info hover:underline">
                        #{card.pr.number}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{card.cost !== undefined ? `$${card.cost.toFixed(2)}` : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={card.startedAt}>
                    {formatRelative(card.startedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {/* A phone has no width for the table's columns: there a run is two lines, what was asked and
          then the rest, and its branch is left to its own page. */}
      {read.rows.length > 0 && (
        <ul className="mt-4 text-sm md:hidden">
          {read.rows.map(({ project, card }) => (
            <li key={`${project.id}/${card.id}`} onClick={() => host.openAgent(project.id, card.id)} className="cursor-pointer border-b border-border py-2 hover:bg-accent">
              <p className="truncate" title={card.intent}>
                {card.intent?.trim() || card.id}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span className={STATUS_CLASS[card.status]}>{card.status}</span>
                {projects.length > 1 && <span>{project.name}</span>}
                {card.pr && (
                  <a href={card.pr.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="text-info hover:underline">
                    #{card.pr.number}
                  </a>
                )}
                {card.cost !== undefined && <span className="tabular-nums">${card.cost.toFixed(2)}</span>}
                <span title={card.startedAt}>{formatRelative(card.startedAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
