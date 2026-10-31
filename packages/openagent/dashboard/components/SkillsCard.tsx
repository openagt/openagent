import { useState } from 'react'
import { CircleCheck, Puzzle } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { onProjectSkills, sendProjectSkills, type ProjectSkills } from '../rpc/skills.js'
import { runModuleCommand } from '../rpc/modules.js'
import { usePolled, cn, Button, Card, CardContent, CardHeader, CardTitle } from '@openagt/skill-ui/module'
import { useAction } from '../lib/use-action.js'
import { sendWord, skillsSay, updateSkills } from './ProjectSkills.js'

// The Overview's Skills card: for each project shown, how its skills stand, and the one press that
// brings them where they should be. Said as the project's own page says it (`skillsSay`): a newer
// version to take, skills not yet where agents start from, and a pull request or a branch they wait
// on; else that they are up to date. A project's name opens its page, where "Skills" lists them all.
// Under the projects, which skills the agents used in the last 30 days, the most used first, from
// the runs' records (`logs skills`, of the logs package, where a project has it), and the skills
// the projects hold that no agent used. With updates in several projects, one press takes them all.

/** One project's skills as read; `null` when they could not be. And the skills its agents used, when its records say. */
interface Read {
  project: ProjectSummary
  skills: ProjectSkills | null
  used: SkillUse[]
}

/** A skill's use, as `logs skills` says it. */
interface SkillUse {
  skill: string
  uses: number
  runs: number
  lastAt: string
}

/** The package that keeps the runs' records, and says which skills they used. */
const LOGS = '@openagt/skill-logs'

/** How many of the most used skills are drawn. */
const TOP = 5

/** Each skill's use over several projects, as one, the most used first. */
export function usedOver(reads: readonly Pick<Read, 'used'>[]): SkillUse[] {
  const bySkill = new Map<string, SkillUse>()
  for (const use of reads.flatMap(read => read.used)) {
    const known = bySkill.get(use.skill)
    if (!known) bySkill.set(use.skill, { ...use })
    else {
      known.uses += use.uses
      known.runs += use.runs
      if (use.lastAt > known.lastAt) known.lastAt = use.lastAt
    }
  }
  return [...bySkill.values()].sort((a, b) => b.uses - a.uses || b.lastAt.localeCompare(a.lastAt))
}

const NONE: Read[] = []

export function SkillsCard({ projects, onSelectProject }: { projects: ProjectSummary[]; onSelectProject: (id: string) => void }) {
  const key = projects.map(project => project.id).join(',')
  const { value: reads, loaded, reload } = usePolled<Read[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<Read> => {
          const [skills, used] = await Promise.all([
            onProjectSkills(project.id).catch(() => null),
            runModuleCommand(project.id, LOGS, ['skills', '--local', '--days', '30']).then(
              result => (result.ok && Array.isArray(result.output) ? (result.output as SkillUse[]) : []),
              () => [],
            ),
          ])
          return { project, skills, used }
        }),
      ),
    NONE,
    // A read of each project's folder, and of its git host only while something is on its way.
    60_000,
    [key],
    // Kept for the next visit: the page opens with the last skills, faded until they are read again.
    { remember: `skills-card:${key}`, stored: true },
  )
  const used = usedOver(reads)
  // The skills a project holds that no agent used: each once, over the projects shown.
  const usedNames = new Set(used.map(use => use.skill))
  const unused = [...new Set(reads.flatMap(read => (read.skills ? skillsSay(read.skills).heldNames : [])))].filter(name => !usedNames.has(name)).sort()
  const updatable = reads.filter(read => read.skills && skillsSay(read.skills).newer.length > 0)
  const [updatingAll, setUpdatingAll] = useState(false)
  const all = useAction()
  const updateAll = async (): Promise<void> => {
    setUpdatingAll(true)
    try {
      // One project after the other: each update sends to its own repository.
      for (const read of updatable) if (!(await updateSkills(read.project.id, read.skills!, all.run)).ok) break
      await reload()
    } finally {
      setUpdatingAll(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Puzzle className="h-4 w-4 text-muted-foreground" aria-hidden />
          Skills
          {updatable.length > 1 && (
            <Button variant="outline" size="xs" className="ml-auto font-normal" disabled={updatingAll} onClick={() => void updateAll()} title={`Take the newer versions in ${updatable.map(read => read.project.name).join(', ')}`}>
              {updatingAll ? 'Updating…' : `Update all (${updatable.length})`}
            </Button>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">What your agents know, and what is new</p>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <ul className="space-y-2">
              {reads.map(read => (
                <Row key={read.project.id} read={read} reload={reload} onOpen={() => onSelectProject(read.project.id)} />
              ))}
            </ul>
            {all.error && <p className="mt-2 text-xs text-danger">{all.error}</p>}
            <Usage used={used} unused={unused} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** One project: its name and how many skills it holds, then what is to be done, with its press, or that all is well. */
function Row({ read, reload, onOpen }: { read: Read; reload: () => Promise<void>; onOpen: () => void }) {
  const { project, skills } = read
  const [pending, setPending] = useState(false)
  const { error, run } = useAction()
  const act = async (action: () => Promise<{ ok: boolean }>): Promise<void> => {
    setPending(true)
    try {
      if ((await action()).ok) await reload()
    } finally {
      setPending(false)
    }
  }
  const says = skills ? skillsSay(skills) : undefined
  return (
    <li aria-label={project.name} className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <button type="button" onClick={onOpen} className="min-w-0 truncate font-medium hover:underline">
          {project.name}
        </button>
        {says && says.held > 0 && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{says.held === 1 ? '1 skill' : `${says.held} skills`}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {!skills || !says ? (
            <span className="text-xs text-danger">could not be read</span>
          ) : says.held === 0 ? (
            // None yet: nothing is up to date, there is nothing. Its page lists them to pick.
            <>
              <span className="text-xs text-muted-foreground">no skills yet</span>
              <Button variant="outline" size="xs" onClick={onOpen} title="Open the project, where Skills lists them to pick">
                Add
              </Button>
            </>
          ) : says.newer.length > 0 ? (
            <Button variant="outline" size="xs" disabled={pending} onClick={() => void act(() => updateSkills(project.id, skills, run))} title={`Newer versions: ${says.newer.join(', ')}`}>
              {pending ? 'Updating…' : `Update ${says.newer.length}`}
            </Button>
          ) : says.sending ? (
            <Button variant="outline" size="xs" disabled={pending} onClick={() => void act(() => run(() => sendProjectSkills(project.id), 'Could not send the skills.'))} title={`Not where agents start from yet: ${says.here.join(', ')}`}>
              {pending ? 'Sending…' : sendWord(skills)}
            </Button>
          ) : says.inRequest ? (
            <a href={skills.request!.url} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline">
              in #{skills.request!.number}
            </a>
          ) : says.onBranch ? (
            <span className="text-xs text-warning" title={`On the branch ${skills.branch}: merge it into ${skills.startBranch ?? 'the default branch'}`}>
              to merge
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-success">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              up to date
            </span>
          )}
        </span>
      </div>
      {/* What waits, in a line under the name: the update, or the skills on their way. */}
      {says && (says.newer.length > 0 || says.sending || says.inRequest) && (
        <p className={cn('truncate text-xs', says.newer.length > 0 ? 'text-warning' : 'text-muted-foreground')}>
          {says.newer.length > 0
            ? `${says.newer.length === 1 ? '1 has a newer version' : `${says.newer.length} have newer versions`}: ${says.newer.join(', ')}`
            : says.sending
              ? `${says.here.length} not where agents start from yet`
              : `${says.waiting.length} waiting in pull request #${skills!.request!.number}`}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  )
}

/**
 * Which skills the agents used in the last 30 days: the most used, each with a thin bar as long as
 * its share of the most used one's, and how often; then the skills held that no agent used, which
 * may be the ones to take out. Nothing when no record says (a project without the logs package).
 */
function Usage({ used, unused }: { used: SkillUse[]; unused: string[] }) {
  if (used.length === 0) return null
  const most = used[0]!.uses
  const more = used.length - TOP
  return (
    <section aria-label="Most used" className="mt-3 border-t border-border pt-3">
      <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Most used, last 30 days</h4>
      <ul className="space-y-1">
        {used.slice(0, TOP).map(use => (
          <li key={use.skill} aria-label={use.skill} className="flex items-center gap-2 text-xs" title={`Used ${use.uses} times in ${use.runs === 1 ? '1 run' : `${use.runs} runs`}`}>
            <span className="w-24 shrink-0 truncate font-mono">{use.skill}</span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted-foreground/15" aria-hidden>
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, Math.round((use.uses / most) * 100))}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{use.uses}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-1 text-xs text-muted-foreground">and {more === 1 ? '1 more' : `${more} more`}</p>}
      {unused.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" title={unused.join(', ')}>
          <span className="text-foreground/80">Not used:</span> {unused.slice(0, 4).join(', ')}
          {unused.length > 4 ? ` and ${unused.length - 4} more` : ''}
        </p>
      )}
    </section>
  )
}
