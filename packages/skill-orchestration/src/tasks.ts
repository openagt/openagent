import { isLevel, LEVELS, type Level } from './levels.js'

/**
 * A plan read as a task list. The main agent writes one markdown file: a `# ` title, the prose
 * every task needs, then one `## ` heading per task with a few keys under it. This module turns
 * that text into the tasks the command starts subagents on, and nothing here touches git or a disk.
 *
 * The prose above the first task is the plan's shared context, and `start` puts it in front of
 * every task: before this, the agent retyped the same sentences into each subagent's prompt — in
 * the run we reviewed all four tasks opened with the same sixty characters. One line of that prose
 * is not context: a `Check:` up there is the project's own checks, which `land` runs once the last
 * task is landed.
 *
 * A task's heading is its name, and the name is what a list of runs calls the subagent that does
 * it; the name slugged is the id `start --task` takes. `Uncertainty:` is borrowed from the ticket
 * plan format and means the same there and here: how many significant alternatives the task holds.
 * Only a task at 0 may be a subagent, since a subagent is told nobody will answer it.
 */

/** The keys a task may carry, under its heading. */
const KEYS = ['level', 'files', 'needs', 'check', 'uncertainty'] as const

/** What a `Needs:` line says when the task waits for nothing. */
const NEEDS_NOTHING = ['none', 'nothing', '-']

export interface PlanTask {
  /** What `start --task` names it: the heading slugged, else its place in the plan. */
  id: string
  /** The heading, word for word: the name that goes on the record of the subagent that does it. */
  name: string
  /** How hard it is, when its `Level:` line says so. */
  level?: Level
  /** The files it owns, as its `Files:` line lists them. */
  files?: string[]
  /** The tasks that must land before it, by their ids, as its `Needs:` line names them. */
  depends?: string[]
  /** How to check it, as its `Check:` line says. */
  check?: string
  /** `0`-`10`: 0 no meaningful alternatives, 10 highly uncertain how to implement. */
  uncertainty?: number
  /** What to change: everything under the heading that is not one of the keys. */
  body: string
}

export interface Plan {
  /** The prose above the first task, which every task is told before its own words. */
  context?: string
  /** How to check the whole plan, as the `Check:` line of its shared context says: the project's own checks, run on the last land. */
  check?: string
  tasks: PlanTask[]
  /** Why this text is no task list; a plan with any of these is not saved. */
  problems: string[]
}

/** A heading's id: lowercase, one dash per run of anything else, and a leading `1.` or `2)` dropped. */
export function taskId(name: string): string {
  return name
    .replace(/^\d+\s*[.)]\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A plan's text as its tasks, its shared context, and what makes it unreadable. */
export function parsePlan(text: string): Plan {
  const lines = text.split('\n')
  const headings = lines.flatMap((line, at) => (/^##\s+\S/.test(line) ? [at] : []))
  const shared = contextOf(headings.length > 0 ? lines.slice(0, headings[0]) : lines)
  const read = headings.map((at, n) => task(lines[at]!.replace(/^##\s+/, '').trim(), lines.slice(at + 1, headings[n + 1]), n + 1))
  const tasks = read.map(({ task }) => task)
  const problems = [...read.flatMap(({ problems }) => problems), ...names(tasks), ...unknownNeeds(tasks)]
  if (tasks.length === 0) problems.push('the plan has no task: write one `## ` heading per task, and the prose every task needs above the first')
  return { ...shared, tasks, problems }
}

/**
 * The plan's shared context: what is above the first task, without the plan's own `# ` title and
 * without any `Check:` line. A `Check:` line up there is the project's own checks, which `land`
 * runs when the last task is landed: it is the plan's, not a task's, so no subagent is told it —
 * every task says how to check its own work under its own heading.
 */
function contextOf(lines: readonly string[]): { context?: string; check?: string } {
  const titleAt = lines.findIndex(line => /^#\s+\S/.test(line))
  const above = titleAt === -1 ? lines : lines.slice(titleAt + 1)
  const isCheck = (line: string) => /^check:/i.test(line)
  const check = bare(above.find(isCheck)?.slice('check:'.length))
  const text = above.filter(line => !isCheck(line)).join('\n').trim()
  return { ...(text !== '' ? { context: text } : {}), ...(check !== undefined ? { check } : {}) }
}

/** One task: its keys taken out of the lines under its heading, the rest its body. */
function task(name: string, lines: readonly string[], place: number): { task: PlanTask; problems: string[] } {
  const given = new Map<string, string>()
  const body: string[] = []
  for (const line of lines) {
    const key = KEYS.find(key => new RegExp(`^${key}:`, 'i').test(line))
    if (key === undefined) body.push(line)
    else if (!given.has(key)) given.set(key, line.slice(key.length + 1).trim())
  }
  const level = bare(given.get('level'))?.toLowerCase()
  const files = list(given.get('files'))
  const needs = list(given.get('needs'))?.filter(one => !NEEDS_NOTHING.includes(one.toLowerCase()))
  const depends = needs !== undefined && needs.length > 0 ? [...new Set(needs.map(taskId))] : undefined
  const check = bare(given.get('check'))
  const uncertainty = scale(given.get('uncertainty'))
  return {
    task: {
      id: taskId(name) || `task-${place}`,
      name,
      ...(isLevel(level) ? { level } : {}),
      ...(files !== undefined ? { files } : {}),
      ...(depends !== undefined ? { depends } : {}),
      ...(check !== undefined ? { check } : {}),
      ...(uncertainty !== undefined ? { uncertainty } : {}),
      body: body.join('\n').trim(),
    },
    problems: level !== undefined && !isLevel(level) ? [`the task "${name}" is at level "${level}": a task is ${LEVELS.join(' or ')}`] : [],
  }
}

/** A comma-separated line as its parts, or `undefined` when the line is missing or empty. */
function list(written: string | undefined): string[] | undefined {
  if (written === undefined) return undefined
  const parts = written
    .split(',')
    .map(part => bare(part) ?? '')
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

/** One value, without the backticks an agent writes a path or a command in. */
function bare(written: string | undefined): string | undefined {
  const text = written?.trim().replace(/^`+|`+$/g, '').trim()
  return text ? text : undefined
}

/**
 * A `0`-`10` value, or `undefined` when the key does not name one. Out-of-range and fractional
 * values are not clamped into something plausible, as in the ticket plan format they come from:
 * they are not a value on this scale, and inventing one hides the typo.
 */
function scale(written: string | undefined): number | undefined {
  if (written === undefined || !/^\d+$/.test(written)) return undefined
  const value = Number(written)
  return value >= 0 && value <= 10 ? value : undefined
}

/** Two tasks that one id names are two tasks the person cannot tell apart, and `--task` cannot either. */
function names(tasks: readonly PlanTask[]): string[] {
  const seen = new Set<string>()
  return tasks.flatMap(task => {
    if (!seen.has(task.id)) return (seen.add(task.id), [])
    return [`two tasks are named "${task.name}": give each task a heading of its own`]
  })
}

/** A `Needs:` naming no task in the plan: a dependency nobody waits for is worse than none. */
function unknownNeeds(tasks: readonly PlanTask[]): string[] {
  const ids = new Set(tasks.map(task => task.id))
  return tasks.flatMap(task => (task.depends ?? []).filter(one => one !== task.id && !ids.has(one)).map(one => `the task "${task.name}" needs "${one}", which is no task in this plan`))
}

/**
 * What a subagent is given for a task: the plan's shared context, then the task's own name and
 * words, then the files it owns and how to check it. What every subagent is told on top of this
 * is added where the subagent is started.
 */
export function taskText(plan: Plan, task: PlanTask): string {
  return [
    plan.context,
    [task.name, task.body].filter(Boolean).join('\n\n'),
    task.files !== undefined ? `The files this task changes: ${task.files.join(', ')}` : undefined,
    task.check !== undefined ? `Check your work with: ${task.check}` : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')
}
