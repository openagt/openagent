import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { excludeFromGit, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { PUBLISH_LEVELS, type Publish } from '@openagt/agent-runner'
import { DEFAULT_AGENT, DEFAULT_MODEL, DEFAULT_PUBLISH, DEFAULT_SPEND_OFFSET, STATE_DIR, STATE_FILE, isAgent, isAgents, isTime, type AgentName } from './names.js'
import { homeAgent, type ScheduledCommand } from './schedule.js'
import type { PacePick } from './pace.js'

/**
 * The tool's state (#1774): one JSON file under `.agent-scheduler/` at the repository root,
 * written by the tool and read by anyone — a dashboard shows it as it is. Per user, never
 * tracked: the directory is hidden through the repository's exclude file, the way `.branches/`
 * is, so no tracked file changes and nothing rides a sweeping `git add -A`.
 *
 * What is here is what would otherwise live in a process's memory: whether the scheduler is on,
 * whether it should outlive whatever started it, the model this user's scheduled runs start on
 * and the spend cushion they take, which scheduled commands this machine switched on, the pace and the number of agents at once a person set for one here, how far this machine's runs of a scheduled command publish where a person picked it, the pid of the scheduler's own process when one runs, and the last tick with what it
 * decided per command. A restart loses nothing.
 */

/** What the tick decided for one command. */
export interface TickDecision {
  command: string
  /** One line, for a person: `started`, `not due`, `cap reached (…)`, `quota: …`, … */
  outcome: string
  /** The run's id, when one was started or resumed. */
  run?: string
}

/** One command of the schedule as the tick read it, for a dashboard to list with its switch. */
export interface ListedCommand {
  command: string
  /** How often at most, as written (`1d`). */
  every?: string
  /** The check, when the skill gives one. */
  when?: string
  /** What the check waits for, in one plain line, when the skill gives one. */
  waitsFor?: string
  /** How often the check runs between the minute's ticks, as written (`15s`), when the skill says. */
  checkEvery?: string
  /** What the command's skill does, in the skill's own words, when it says. */
  description?: string
  /** Whether the row resumes the runs its check names, each on its own coding agent and model, and starts none. */
  resumes?: true
  /** How many runs of the command its skill lets be in flight at once, when it is more than one. */
  agents?: number
  /** Whether the command is an automation a person keeps on this machine alone, not a skill of the project. */
  onThisMachine?: true
  /** Whether the command is a person's own automation as the tool wrote it: `show`, `edit` and `remove` take it. */
  editable?: true
  /** The coding agent the command is made for: the one its skill names, else Claude Code when it can run the command, else the one that can. */
  agent: AgentName
  /** The model its skill names, when it names one. */
  model?: string
  /** The coding agent that model is a model of: the one the skill names, Claude Code when it names none. Said with the model. */
  modelAgent?: AgentName
  /** The coding agents that can run the command: those whose own skills folder holds its skill; every one for an automation kept on this machine. */
  able: AgentName[]
}

/** One tick as the state remembers it. */
export interface TickRecord {
  /** ISO timestamp. */
  at: string
  decisions: TickDecision[]
  /** The schedule's commands, as this tick read them. */
  schedule: ListedCommand[]
  /** Why the tick decided nothing for the scheduled commands, when it could not: the scheduler is off, no skill schedules a command, the pull failed. */
  note?: string
}

export interface State {
  /** Whether ticks start agents. Off is the default: nothing runs until a person says so. */
  on: boolean
  /** Whether the scheduler's process outlives whatever started it. Read by `stop --unless-keep-alive` only, the line a dashboard runs when it closes. */
  keepAlive: boolean
  /** The model a scheduled run on Claude Code starts on, where neither its command's skill nor a person names another. */
  model: string
  /** How far past the spend boundary a run may still start, in percentage points. */
  spendOffset: number
  /** The scheduled commands this machine switched on, each with when it was, ISO. Every command starts switched off: a skill that arrives in a project starts no agent by itself. */
  switches?: Record<string, string>
  /** This machine's publish pick per command. */
  publishes?: Record<string, PublishPick>
  /** This machine's pace per command, kept only where a person set one: a command without one runs at its skill's pace. */
  paces?: Record<string, PacePick>
  /** This machine's number of runs of a command in flight at once, kept only where a person set one: a command without one has its skill's number. */
  agents?: Record<string, number>
  /** The coding agent this machine's runs of a command are on, kept only where a person picked one: a command without one is on the agent its skill is made for. */
  runsOn?: Record<string, AgentName>
  /** The model this machine's runs of a command start on, kept only where a person picked one, with the coding agent it was picked for: a model is one agent's, and the pick holds only while the command runs on that agent. */
  models?: Record<string, ModelPick>
  /** The scheduler's own process, while `start` has one running. */
  pid?: number
  /** When that process started, ISO. */
  startedAt?: string
  lastTick?: TickRecord
}

/** A person's pick of how far a scheduled command's runs publish on their machine: nothing, or one of the levels a run may be given. */
export type PublishPick = 'nothing' | Publish

export const PUBLISH_PICKS: readonly PublishPick[] = ['nothing', ...PUBLISH_LEVELS]

/** A person's pick of a model for one command: the model's id, and the coding agent it is a model of. */
export interface ModelPick {
  agent: AgentName
  model: string
}

/** Where the state keeps what a person set for one command on this machine. */
const PICKS = ['switches', 'publishes', 'paces', 'agents', 'runsOn', 'models'] as const

export const DEFAULT_STATE: State = { on: false, keepAlive: false, model: DEFAULT_MODEL, spendOffset: DEFAULT_SPEND_OFFSET }

export function stateDir(repo: string): string {
  return join(repo, STATE_DIR)
}

export function statePath(repo: string): string {
  return join(stateDir(repo), STATE_FILE)
}

/** The state as written, defaults filled in; the default state when there is none or it does not parse. */
export async function readState(repo: string): Promise<State> {
  const raw = await readFile(statePath(repo), 'utf8').catch(() => undefined)
  if (raw === undefined) return { ...DEFAULT_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<State>
    return { ...DEFAULT_STATE, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/**
 * Write the state. The first write also hides the directory from git; that is best-effort, since
 * a repository whose exclude file cannot be written still has a scheduler.
 */
export async function writeState(repo: string, state: State, git: GitRunner = nodeGitRunner()): Promise<void> {
  await mkdir(stateDir(repo), { recursive: true })
  await excludeFromGit(repo, `/${STATE_DIR}`, undefined, git).catch(() => {})
  await writeFile(statePath(repo), JSON.stringify(state, null, 2) + '\n')
}

/**
 * The state without the scheduler's process, when that process is `pid`; unchanged otherwise. A
 * scheduler ending must not clear a pid another scheduler wrote meanwhile: a dashboard's close
 * hook stops one and its open hook starts the next while the first still finishes its tick.
 */
export function withoutPid(state: State, pid: number): State {
  if (state.pid !== pid) return state
  const { pid: _pid, startedAt: _startedAt, ...rest } = state
  return rest
}

/**
 * The state with nothing of one command left: its switch, its publish pick, its pace, its number
 * of agents, its coding agent and its model. What a command saved anew under a name starts from: a switch left on for a
 * command of that name that is gone would start the new one unasked.
 */
export function withoutCommand(state: State, command: string): State {
  let rest = state
  for (const key of PICKS) {
    const picks = state[key]
    if (!picks || !Object.hasOwn(picks, command)) continue
    const { [command]: _gone, ...others } = picks as Record<string, unknown>
    // The state itself is answered when it holds nothing of the command, so a caller can tell there is nothing to write.
    rest = { ...rest }
    if (Object.keys(others).length) Object.assign(rest, { [key]: others })
    else delete rest[key]
  }
  return rest
}

/**
 * The state with a command off the last tick's record: the schedule it read and what it decided.
 * For a command removed since that tick, so whoever lists the record's commands, a dashboard,
 * stops listing it at once and not a tick later. The state itself is answered when the record
 * names no such command.
 */
export function withoutListed(state: State, command: string): State {
  const tick = state.lastTick
  if (!tick || !(tick.schedule.some(c => c.command === command) || tick.decisions.some(d => d.command === command))) return state
  return { ...state, lastTick: { ...tick, schedule: tick.schedule.filter(c => c.command !== command), decisions: tick.decisions.filter(d => d.command !== command) } }
}

/**
 * The names whose picks on this machine go before a tick: an automation kept here that the last
 * tick listed and whose file is gone now (removed or renamed), and a name a skill and an
 * automation kept here both have. A switch left under such a name would otherwise start whatever
 * takes the name next: a skill of the project, which starts no agent before a person switches it on.
 * An automation whose file is still there keeps its picks, also while a slip in the file keeps it
 * off the list.
 */
export function namesGivenUp(lastTick: TickRecord | undefined, schedule: { commands: { name: string; text?: string }[]; unreadable?: { skill: string; own?: true }[]; clashes?: string[] }): string[] {
  const kept = new Set([...schedule.commands.filter(c => c.text !== undefined).map(c => c.name), ...(schedule.unreadable ?? []).filter(u => u.own).map(u => u.skill)])
  const gone = (lastTick?.schedule ?? []).filter(c => c.onThisMachine === true && !kept.has(c.command)).map(c => c.command)
  return [...new Set([...gone, ...(schedule.clashes ?? [])])]
}

/** The state with nothing left under a name: the picks of the command of that name, and of every command that is that name and a word (`triage quick`). */
export function withoutName(state: State, name: string): State {
  let rest = state
  for (const key of PICKS) {
    for (const command of Object.keys(state[key] ?? {})) {
      if (command.split(' ')[0] === name) rest = withoutCommand(rest, command)
    }
  }
  return rest
}

/** When a person switched a scheduled command on on this machine, ISO; nothing for a command that is off. The state is a file a person may edit: anything but a time is off. */
export function switchedOnAt(state: State, command: string): string | undefined {
  const at = state.switches?.[command]
  return isTime(at) ? at : undefined
}

/** Whether a scheduled command runs on this machine: only where a person switched it on. */
export function isSwitchedOn(state: State, command: string): boolean {
  return switchedOnAt(state, command) !== undefined
}

/** The state with one command switched on at a time, or off when no time is given: only a command switched on is kept, so switching it off leaves no trace. */
export function withSwitch(state: State, command: string, at: string | undefined): State {
  const { [command]: _previous, ...others } = state.switches ?? {}
  const switches = at !== undefined ? { ...others, [command]: at } : others
  const { switches: _switches, ...rest } = state
  return Object.keys(switches).length ? { ...rest, switches } : rest
}

/**
 * This machine's publish pick for a scheduled command: what a person picked here, else commit. The
 * state is a file a person may edit: a word that is no pick is no pick.
 */
function publishPick(state: State, command: string): PublishPick {
  const pick = state.publishes?.[command]
  return pick !== undefined && PUBLISH_PICKS.includes(pick) ? pick : DEFAULT_PUBLISH
}

/** How far a run of a scheduled command publishes on this machine: its publish pick here; absent for nothing. */
export function publishInForce(state: State, command: string): Publish | undefined {
  const pick = publishPick(state, command)
  return pick === 'nothing' ? undefined : pick
}

/** The state with one command's publish pick set. */
export function withPublish(state: State, command: string, pick: PublishPick): State {
  return { ...state, publishes: { ...state.publishes, [command]: pick } }
}

/** The state with one command's pace set, or taken back when there is none: the command then runs at its skill's pace again. */
export function withPace(state: State, command: string, pick: PacePick | undefined): State {
  const { [command]: _previous, ...others } = state.paces ?? {}
  const paces = pick === undefined ? others : { ...others, [command]: pick }
  const { paces: _paces, ...rest } = state
  return Object.keys(paces).length ? { ...rest, paces } : rest
}

/**
 * How many runs of a command may be in flight at once, as this machine counts: the number a
 * person set here, else the skill's. The count it is held against is every machine's runs. The
 * state is a file a person may edit: a value that is no such number is no number set.
 */
export function capInForce(state: State, command: { name: string; cap: number }): number {
  const own = state.agents?.[command.name]
  return isAgents(own) ? own : command.cap
}

/** The state with one command's number of agents at once set, or taken back when there is none: the command then has its skill's number again. */
export function withAgents(state: State, command: string, count: number | undefined): State {
  const { [command]: _previous, ...others } = state.agents ?? {}
  const agents = count === undefined ? others : { ...others, [command]: count }
  const { agents: _agents, ...rest } = state
  return Object.keys(agents).length ? { ...rest, agents } : rest
}

/**
 * The coding agent a run of a command is on, on this machine: the one a person picked here, else
 * the one the command is made for ({@link homeAgent}). The state is a file a person may edit: a
 * word that names no agent is no pick.
 */
export function agentInForce(state: State, command: Pick<ScheduledCommand, 'name' | 'agent' | 'dirs' | 'text'>): AgentName {
  const pick = state.runsOn?.[command.name]
  return isAgent(pick) ? pick : homeAgent(command)
}

/**
 * The model a run of a command starts on, on this machine, given the agent it is on: the one a
 * person picked here for that agent; else the one its skill names for that agent
 * ({@link ScheduledCommand.model}); else, on Claude Code, the scheduler's own model. Nothing on
 * any other agent: the run then starts on that agent's own default. A pick made for another agent
 * is no pick: the agent a command runs on can change without a person's doing, when its skill
 * comes to name one or reaches another agent's folder.
 */
export function modelInForce(state: State, command: Pick<ScheduledCommand, 'name' | 'agent' | 'model'>, agent: AgentName): string | undefined {
  const pick = state.models?.[command.name]
  if (pick && typeof pick === 'object' && pick.agent === agent && typeof pick.model === 'string' && pick.model.trim()) return pick.model
  if (command.model !== undefined && agent === (command.agent ?? DEFAULT_AGENT)) return command.model
  return agent === DEFAULT_AGENT ? state.model : undefined
}

/** The state with the coding agent of one command picked, or the pick taken back when there is none. The model picked for the command goes with it either way: a model is one agent's. */
export function withAgent(state: State, command: string, agent: AgentName | undefined): State {
  const { [command]: _previous, ...others } = state.runsOn ?? {}
  const runsOn = agent === undefined ? others : { ...others, [command]: agent }
  const { runsOn: _runsOn, ...rest } = withModel(state, command, undefined)
  return Object.keys(runsOn).length ? { ...rest, runsOn } : rest
}

/** The state with the model of one command picked, for the coding agent it is a model of, or the pick taken back when there is none. */
export function withModel(state: State, command: string, pick: ModelPick | undefined): State {
  const { [command]: _previous, ...others } = state.models ?? {}
  const models = pick === undefined ? others : { ...others, [command]: pick }
  const { models: _models, ...rest } = state
  return Object.keys(models).length ? { ...rest, models } : rest
}

/** Read, change, write: one edit of the state. */
export async function updateState(repo: string, change: (state: State) => State, git?: GitRunner): Promise<State> {
  const next = change(await readState(repo))
  await writeState(repo, next, git)
  return next
}
