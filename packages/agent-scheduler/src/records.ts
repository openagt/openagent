import { runnerMark } from '@openagt/agent-runner'
import { listRuns, type LogsDeps, type RunCard } from '@openagt/skill-logs'
import { isTime } from './names.js'
import { promptCommand, type Schedule } from './schedule.js'

/**
 * The runs a command has, read off the run records on the project's `agent-data` branch, so
 * every machine that shares the branch counts the same ones against a command's cap and pace. A
 * record names only what its run was asked; which command of the schedule that is, is decided
 * here when the records are counted: the scheduled command the prompt names, else the prompt's first
 * word without its slash. A run a person started from a dashboard counts like a scheduled one.
 * Only runs `agent-runner` started, which carry its mark, are counted.
 *
 * A run a row resumed counts for that row too, from its resume on: its record keeps who resumed it
 * and when, and the row counts the resume as its start.
 */

/**
 * The command a run counts for, as the machine `host` counts; `undefined` for a run
 * `agent-runner` did not start, and for one whose prompt names no command. A run of an automation
 * kept on a machine counts on that machine alone: another person may keep one of the same name,
 * and theirs is another automation.
 */
export function commandOf(card: RunCard, schedule: Schedule, host: string): string | undefined {
  const mark = runnerMark(card)
  if (!mark || card.intent === undefined) return undefined
  const command = promptCommand(card.intent, schedule)
  if (command === undefined) return undefined
  const own = schedule.commands.some(c => c.name === command && c.text !== undefined)
  return own && mark.host !== host ? undefined : command
}

/** The row that last resumed a run, and when, as the machine `host` counts: only its own runs are resumed here. */
function resumedBy(card: RunCard, host: string): { by: string; at: string } | undefined {
  const mark = runnerMark(card)
  return mark?.host === host && mark.resumed !== undefined && isTime(mark.resumed.at) ? mark.resumed : undefined
}

/** When a run started for a command, as `host` counts: its own start for the command it was started for, its last resume for the row that resumed it; nothing for any other command. */
function startFor(card: RunCard, command: string, schedule: Schedule, host: string): string | undefined {
  const resumed = resumedBy(card, host)
  if (resumed?.by === command) return resumed.at
  return commandOf(card, schedule, host) === command && isTime(card.startedAt) ? card.startedAt : undefined
}

/**
 * When one command last started, whatever became of the run; nothing when it never did. A skill's
 * command counts every machine's runs; an automation kept on this machine, this machine's. A
 * scheduled run's start is when its command was asked about, before its check ran: the tick gives
 * the run that moment as its start. A record whose start is not a time is not counted.
 */
export async function lastStart(repo: string, command: string, schedule: Schedule, host: string, deps: LogsDeps = {}): Promise<string | undefined> {
  const cards = await listRuns(repo, {}, deps)
  let latest: string | undefined
  for (const card of cards) {
    const at = startFor(card, command, schedule, host)
    if (at !== undefined && (latest === undefined || at > latest)) latest = at
  }
  return latest
}

/** A command's last run, as a dashboard lists it: which run, when it started, and whether it failed. */
export interface LastRun {
  id: string
  /** When the run started, ISO. */
  at: string
  /** Whether the run ended `failed`. */
  failed?: true
}

/**
 * Each command's last run: the latest run it has, by its start, whatever became of it. It says
 * `failed` only when that run ended `failed`: one still going, ended well, stopped by a person or
 * waiting for an answer does not, so a later run takes a failure's place. Counted like the
 * starts: every machine's runs for a skill's command, this machine's for an automation kept here.
 */
export async function lastRuns(repo: string, schedule: Schedule, host: string, deps: LogsDeps = {}): Promise<Record<string, LastRun>> {
  const latest = new Map<string, LastRun>()
  for (const card of await listRuns(repo, {}, deps)) {
    for (const command of new Set([commandOf(card, schedule, host), resumedBy(card, host)?.by])) {
      const at = command === undefined ? undefined : startFor(card, command, schedule, host)
      if (command === undefined || at === undefined) continue
      const known = latest.get(command)
      if (!known || at > known.at) latest.set(command, { id: card.id, at, ...(card.status === 'failed' ? { failed: true as const } : {}) })
    }
  }
  return Object.fromEntries(latest)
}

/** The runs of one command still in flight: on any machine for a skill's command, on this one for an automation kept here and for a row that resumed them. */
export async function inFlight(repo: string, command: string, schedule: Schedule, host: string, deps: LogsDeps = {}): Promise<RunCard[]> {
  const cards = await listRuns(repo, {}, deps)
  return cards.filter(card => card.status === 'running' && (commandOf(card, schedule, host) === command || resumedBy(card, host)?.by === command))
}
