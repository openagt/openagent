import type { ModuleHost, ModuleProject } from '@openagt/dashboard/module'
import type { PublishPick, TickDecision } from '../src/state.js'
import { AGENTS, AGENT_LABELS, AGENT_SKILLS_DIR, DEFAULT_AGENT, DEFAULT_PUBLISH, isAgent, isAgents, isTime, type AgentName } from '../src/names.js'
import { MAX_COUNT, dueFrom, paceInForce, parseInterval, parseTimeOfDay, takesTimeOfDay, type PacePick, type PaceUnit } from '../src/pace.js'

// What the module shows of each project's scheduler: the answer of `agent-scheduler status`, the
// state file as it stands, whether the scheduler's process is alive, and the schedule as the
// project's files say it at that moment. Forgiving: a field that is
// not what the command promises reads as absent, and a project whose command fails is a row that
// says why.

/** The publish picks a person can make for a scheduled command, in the menu's order, with their labels. No level is the first: the run is told none, and does what its skill says. */
export const PUBLISH_LABELS: Readonly<Record<PublishPick, string>> = {
  nothing: 'As the skill says',
  commit: 'Commit',
  branch: 'Publish branch',
  pr: 'Open PR',
  merge: 'Merge on green',
}

/** A publish pick's label in a row's menu: a row a person made has no skill to follow, so no level is "As the prompt says" there. */
export function publishLabel(pick: PublishPick, own: boolean): string {
  return pick === 'nothing' && own ? 'As the prompt says' : PUBLISH_LABELS[pick]
}

const PUBLISH_PICKS = Object.keys(PUBLISH_LABELS) as PublishPick[]

/** How far the spend offset reaches either side of the quota boundary, in percentage points: the reach of the usage bar's handle. */
import { MAX_SPEND_OFFSET } from '@openagt/dashboard/module'
export { MAX_SPEND_OFFSET }

/** One command the project's skills schedule, as its file says it now, with this machine's switch and publish pick. */
export interface SchedulerCommand {
  command: string
  /** How often at most, as written (`1d`). */
  every?: string
  /** The check, when the skill gives one. */
  when?: string
  /** What the check waits for, in one plain line, when the skill gives one. */
  waitsFor?: string
  /** Whether it runs on this machine: off until a person switched it on here. */
  on: boolean
  /** How far a run of the command publishes on this machine: the pick made here, commit until one is made. */
  publish: PublishPick
  /** This machine's pace for the command, where a person set one: it stands in for the skill's interval. */
  pace?: PacePick
  /** How many runs of the command its skill lets be in flight at once, when it is more than one. */
  skillAgents?: number
  /** This machine's number of runs of the command in flight at once, where a person set one: it stands in for the skill's. */
  agents?: number
  /** What the command's skill does, in the skill's own words, when it says. */
  description?: string
  /** Whether the row resumes the runs its check names, each on its own coding agent, model and publish level: it has none of them to pick. */
  resumes?: true
  /** Whether the command is an automation the person keeps on this machine alone, not a skill of the project. */
  onThisMachine?: true
  /** Whether the command is a person's own automation as the tool wrote it: the page can open it to be saved again, and remove it. */
  editable?: true
  /** The command's last run, when it has one: which run, when it started, and whether it failed. */
  lastRun?: LastRun
  /** What the scheduler's last tick decided for the command, when it decided anything. */
  decision?: TickDecision
  /** The coding agent the command is made for: where its runs are on until a person picks another here. */
  home: AgentName
  /** The model its skill names, when it names one. */
  skillModel?: string
  /** The coding agent that model is a model of: the runs start on it only while they are on that agent. */
  skillModelAgent?: AgentName
  /** The coding agents that can run the command: those whose own skills folder holds its skill. */
  able: readonly AgentName[]
  /** The coding agent this machine's runs of the command are on, where a person picked another than the one it is made for. */
  runsOn?: AgentName
  /** The model this machine's runs of the command start on, where a person picked one for the agent its runs are on. A pick made for another agent is none. */
  model?: string
}

/** The coding agent a row's runs are on, on this machine: the one picked here, else the one the row is made for. */
export function agentOf(command: Pick<SchedulerCommand, 'home' | 'runsOn'>): AgentName {
  return command.runsOn ?? command.home
}

/**
 * The model a row's runs start on, on this machine, given the agent they are on: the one picked
 * here for that agent; else the one its skill names for that agent; else, on Claude Code, the
 * scheduler's own. Nothing on another agent: its runs start on that agent's own default. The same
 * rule the scheduler follows. `agent` may be one being tried in the panel: the pick, made for the
 * agent the runs are on now, does not go with another.
 */
export function modelOf(command: Pick<SchedulerCommand, 'home' | 'runsOn' | 'model' | 'skillModel' | 'skillModelAgent'>, schedulerModel: string | undefined, agent: AgentName = agentOf(command)): string | undefined {
  return (agent === agentOf(command) ? command.model : undefined) ?? (agent === command.skillModelAgent ? command.skillModel : undefined) ?? (agent === DEFAULT_AGENT ? schedulerModel : undefined)
}

/** A coding agent as the page is given it: its name for a run, its label, and the models it lists. */
export interface AgentModels {
  value: string
  label: string
  models: readonly { value: string; label: string }[]
  /** Why it lists no model, in words: it is still being asked, or could not say. */
  modelsNote?: string
}

/** A model's name as its agent lists it, the id itself for one it does not list. */
export function modelLabel(agents: readonly AgentModels[], agent: AgentName, id: string): string {
  return agents.find(a => a.value === agent)?.models.find(m => m.value === id)?.label ?? id
}

/** What a row that resumes runs on, in the place where another row picks its agent and model: each run's own. */
export const RESUMES_ON = 'Answers on the coding agent and model that opened the pull request'

/** What a row's runs are on, for its line: the agent, and the model when one is named ("Claude Code, Opus 5.5"; "Codex"); each run's own for a row that resumes. */
export function runsOnWords(command: SchedulerCommand, schedulerModel: string | undefined, agents: readonly AgentModels[]): string {
  if (command.resumes) return RESUMES_ON
  const agent = agentOf(command)
  const model = modelOf(command, schedulerModel, agent)
  return model === undefined ? AGENT_LABELS[agent] : `${AGENT_LABELS[agent]}, ${modelLabel(agents, agent, model)}`
}

/** A command's last run as the scheduler lists it: the run's id, when it started (ISO), and whether it failed. */
export interface LastRun {
  id: string
  at: string
  failed?: true
}

/** A row's last run out of what `status` printed; nothing when it is not what the command promises. */
function lastRunOf(value: unknown): LastRun | undefined {
  const run = record(value)
  if (typeof run['id'] !== 'string' || run['id'] === '' || !isTime(run['at'])) return undefined
  return { id: run['id'], at: run['at'], ...(run['failed'] === true ? { failed: true as const } : {}) }
}

/**
 * Whether a row is one a person made with "New automation", and no skill of the project: its file
 * reads as the tool writes one, or it is kept on this machine alone. The page lists the two kinds
 * apart.
 */
export function isOwn(command: Pick<SchedulerCommand, 'editable' | 'onThisMachine'>): boolean {
  return command.editable === true || command.onThisMachine === true
}

/** A row's name as the page writes it: the command with its slash, as a person types it; an automation kept on this machine is no command to type, so its name alone. */
export function rowTitle(command: Pick<SchedulerCommand, 'command' | 'onThisMachine'>): string {
  return command.onThisMachine ? command.command : `/${command.command}`
}

/** A skill of the project whose `schedule` the scheduler could not read, with why: its commands are missing from the list. Marked `own`, an automation kept on this machine that is not listed. */
export interface UnreadableSchedule {
  skill: string
  reason: string
  own?: true
}

/** What the page says of something the scheduler could not list, in a sentence. */
export function unlistedWords(unreadable: UnreadableSchedule): string {
  return unreadable.own ? `The automation ${unreadable.skill}, kept on this machine, is not listed: ${unreadable.reason}` : `The schedule of the ${unreadable.skill} skill cannot be read, so it is not listed: ${unreadable.reason}`
}

/** One project's scheduler, as its `status` answered. */
export interface SchedulerRow {
  project: ModuleProject
  /** Why the status could not be read; the rest is then empty. */
  error?: string
  /** Whether ticks start agents. */
  on: boolean
  /** Whether the scheduler's process outlives the dashboard that started it. */
  keepAlive: boolean
  /** Whether the scheduler's own process is alive on this machine. */
  running: boolean
  /** The model every scheduled run starts on. */
  model?: string
  /** How far past the quota boundary the project's scheduled runs may still start, in percentage points. */
  spendOffset?: number
  lastTick?: { at: string; decisions: TickDecision[]; note?: string }
  /** The scheduled commands; empty where no skill of the project schedules one. */
  commands: SchedulerCommand[]
  /** The skills whose `schedule` cannot be read, and the automations kept on this machine that are not listed. */
  unreadable: UnreadableSchedule[]
}

function isPick(value: unknown): value is PublishPick {
  return (PUBLISH_PICKS as unknown[]).includes(value)
}

/** Whether a value of the state reads as a pace a person set: "whenever there is work", or an interval the tool reads. */
function isPace(value: unknown): boolean {
  // The same two readings as the tool's own (`paceInForce`): anything else is no pace, and the row says its skill's.
  const pick = record(value)
  return pick['work'] === true || (typeof pick['every'] === 'string' && parseInterval(pick['every']) !== undefined)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** What a tick says of a skill whose `schedule` it could not read, before the reason. */
const UNREADABLE = 'unreadable schedule: '

/** What a tick says of an automation kept on this machine that it does not list, before the reason. */
const UNLISTED = 'unlisted automation: '

/** A project's row from what `status` printed: each scheduled command as the project's files say it now, with this machine's switch and picks and the last tick's decision folded in, and the skills whose schedule cannot be read. */
export function schedulerRow(project: ModuleProject, output: unknown): SchedulerRow {
  const state = record(output)
  const tick = record(state['lastTick'])
  const switches = record(state['switches'])
  const publishes = record(state['publishes'])
  const paces = record(state['paces'])
  const agents = record(state['agents'])
  const runsOn = record(state['runsOn'])
  const models = record(state['models'])
  const decisions: TickDecision[] = []
  for (const item of Array.isArray(tick['decisions']) ? (tick['decisions'] as unknown[]) : []) {
    const d = record(item)
    if (typeof d['command'] !== 'string' || typeof d['outcome'] !== 'string') continue
    decisions.push({ command: d['command'], outcome: d['outcome'], ...(typeof d['run'] === 'string' ? { run: d['run'] } : {}) })
  }
  const commands: SchedulerCommand[] = []
  for (const item of Array.isArray(state['schedule']) ? (state['schedule'] as unknown[]) : []) {
    const row = record(item)
    const command = row['command']
    if (typeof command !== 'string') continue
    const picked = publishes[command]
    const home = isAgent(row['agent']) ? row['agent'] : DEFAULT_AGENT
    const on = isAgent(runsOn[command]) ? runsOn[command] : home
    const modelPick = record(models[command])
    // A line that says something is not listed is no decision of a command, though it may carry a command's name.
    const decision = decisions.find(d => d.command === command && !d.outcome.startsWith(UNREADABLE) && !d.outcome.startsWith(UNLISTED))
    commands.push({
      command,
      ...(typeof row['every'] === 'string' ? { every: row['every'] } : {}),
      ...(typeof row['when'] === 'string' ? { when: row['when'] } : {}),
      ...(typeof row['waitsFor'] === 'string' ? { waitsFor: row['waitsFor'] } : {}),
      on: isTime(switches[command]),
      publish: isPick(picked) ? picked : DEFAULT_PUBLISH,
      ...(isPace(paces[command]) ? { pace: paces[command] as PacePick } : {}),
      ...(isAgents(row['agents']) && row['agents'] > 1 ? { skillAgents: row['agents'] } : {}),
      ...(isAgents(agents[command]) ? { agents: agents[command] } : {}),
      home,
      ...(typeof row['model'] === 'string' && row['model'] !== '' ? { skillModel: row['model'], skillModelAgent: isAgent(row['modelAgent']) ? row['modelAgent'] : DEFAULT_AGENT } : {}),
      able: Array.isArray(row['able']) ? AGENTS.filter(agent => (row['able'] as unknown[]).includes(agent)) : AGENTS,
      // The agent the row is made for is no pick, whatever the state still holds; and a model picked for another agent than the one its runs are on is none.
      ...(on !== home ? { runsOn: on } : {}),
      ...(modelPick['agent'] === on && typeof modelPick['model'] === 'string' && modelPick['model'].trim() !== '' ? { model: modelPick['model'] } : {}),
      ...(typeof row['description'] === 'string' ? { description: row['description'] } : {}),
      ...(row['resumes'] === true ? { resumes: true as const } : {}),
      ...(row['onThisMachine'] === true ? { onThisMachine: true as const } : {}),
      ...(row['editable'] === true ? { editable: true as const } : {}),
      ...(lastRunOf(row['lastRun']) ? { lastRun: lastRunOf(row['lastRun'])! } : {}),
      ...(decision ? { decision } : {}),
    })
  }
  const offset = state['spendOffset']
  return {
    project,
    on: state['on'] === true,
    keepAlive: state['keepAlive'] === true,
    running: state['running'] === true,
    ...(typeof state['model'] === 'string' ? { model: state['model'] } : {}),
    ...(typeof offset === 'number' && Number.isFinite(offset) ? { spendOffset: offset } : {}),
    ...(typeof tick['at'] === 'string' ? { lastTick: { at: tick['at'], decisions, ...(typeof tick['note'] === 'string' ? { note: tick['note'] } : {}) } } : {}),
    commands,
    unreadable: (Array.isArray(state['unreadable']) ? (state['unreadable'] as unknown[]) : []).flatMap((item): UnreadableSchedule[] => {
      const said = record(item)
      return typeof said['skill'] === 'string' && typeof said['reason'] === 'string' ? [{ skill: said['skill'], reason: said['reason'], ...(said['own'] === true ? { own: true as const } : {}) }] : []
    }),
  }
}

/** Every project's scheduler, one row per project in the order given: `agent-scheduler status` run in each. */
export function readSchedulers(host: ModuleHost, projects: readonly ModuleProject[]): Promise<SchedulerRow[]> {
  return Promise.all(
    projects.map(async project => {
      const answer = await host.runCommand(project.id, ['status'])
      return answer.ok ? schedulerRow(project, answer.output) : { project, error: answer.error, on: false, keepAlive: false, running: false, commands: [], unreadable: [] }
    }),
  )
}

/**
 * The spend offset in force across the projects: the loosest one, since it is the one that lets
 * scheduled work spend the furthest; `undefined` when no project answered one. A save writes every
 * project, so the schedulers agree unless one was set by hand.
 */
export function loosestSpendOffset(rows: readonly SchedulerRow[]): number | undefined {
  const offsets = rows.flatMap(row => (row.spendOffset !== undefined ? [row.spendOffset] : []))
  return offsets.length ? Math.max(...offsets) : undefined
}

/** The projects whose spend offset is not the one in force (the loosest), each with its own, to one decimal: what a save would bring into line. */
export function offsetsThatDiffer(rows: readonly SchedulerRow[]): { name: string; offset: number }[] {
  const loosest = loosestSpendOffset(rows)
  return rows.flatMap(row => (row.spendOffset !== undefined && row.spendOffset !== loosest ? [{ name: row.project.name, offset: Math.round(row.spendOffset * 10) / 10 }] : []))
}

/** The spend offset a typed text means: a whole number of points held to the reach of the usage bar's handle; `undefined` while the text is no number yet (empty, a minus sign alone). */
export function typedOffset(raw: string): number | undefined {
  if (raw.trim() === '' || !Number.isFinite(Number(raw))) return undefined
  return Math.min(Math.max(Math.round(Number(raw)), -MAX_SPEND_OFFSET), MAX_SPEND_OFFSET)
}

export type Saved = { ok: true } | { ok: false; error: string }

/** Save the spend offset in every project: `agent-scheduler offset -- <points>`, the `--` so a negative value is no flag. Each failing project is named. */
export async function saveSpendOffset(host: ModuleHost, projects: readonly ModuleProject[], points: number): Promise<Saved> {
  const answers = await Promise.all(projects.map(async project => ({ project, answer: await host.runCommand(project.id, ['offset', '--', String(points)]) })))
  const failed = answers.flatMap(({ project, answer }) => (answer.ok ? [] : [`${project.name}: ${answer.error}`]))
  return failed.length ? { ok: false, error: failed.join('; ') } : { ok: true }
}

/** The picks a scheduled command's publish menu lists: every one where the project has a git host package, else no level, Commit and Publish branch, since no pull request can be opened; and the pick in force when the project is not offered it. */
export function publishChoices(gitHost: boolean, saved: PublishPick): readonly PublishPick[] {
  const offered: readonly PublishPick[] = gitHost ? PUBLISH_PICKS : ['nothing', 'commit', 'branch']
  return offered.includes(saved) ? offered : [...offered, saved]
}

/** A unit's word on the page, in the order the menu lists them. */
export const UNIT_WORDS: Readonly<Record<PaceUnit, string>> = { m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month' }

/** An interval as written, spelled out: `15m` is "15 minutes", `1h` is "1 hour", `2w` is "2 weeks". One the tool would not have read is shown as written. */
export function spelled(every: string): string {
  const read = parseInterval(every)
  return read ? `${read.count} ${UNIT_WORDS[read.unit]}${read.count === 1 ? '' : 's'}` : every
}

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** What a row with a shell line waits for, when its words do not say: the line itself. */
export const PRINTS_SOMETHING = 'when its shell line prints something'

/**
 * How often a scheduled command runs, as a sentence, by the pace in force: this machine's, else
 * its skill's. An interval is "Every 6 hours", with "at most" before what its check waits for
 * when it has a check; a time of day is "Every 2 days at 10:00"; a command its check alone paces
 * says what the check waits for. A check whose skill gives no plain line is "when its check finds
 * work". Beside a check a time of day is "from 10:00": the command starts once the check finds
 * work, which may be later that day.
 */
export function pace(command: SchedulerCommand): string {
  const waits = command.waitsFor ?? PRINTS_SOMETHING
  const skills = command.every === undefined ? undefined : parseInterval(command.every)
  const inForce = paceInForce(command.pace, { ...(skills ? { every: skills } : {}), ...(command.when !== undefined ? { when: command.when } : {}) })
  // An interval of the skill's the tool would not have read is shown as written.
  const every = inForce ? spelled(inForce.every.text) : command.pace === undefined && command.every !== undefined ? command.every : undefined
  if (every === undefined) return sentence(waits)
  if (command.when === undefined) return inForce?.at ? `Every ${every} at ${inForce.at.text}` : `Every ${every}`
  return inForce?.at ? `Every ${every} from ${inForce.at.text}, ${waits}` : `Every ${every} at most, ${waits}`
}

/** Whether the pace a command runs at is one a person set on this machine, not its skill's. */
export function ownPace(command: SchedulerCommand): boolean {
  return draftOf(command).kind !== 'skill'
}

/**
 * A pace as the Edit box holds it while a person picks: the skill's own, whenever there is work,
 * or an interval typed as a count and a unit with an optional time of day. The count and the time
 * are text, as typed, so a half-typed one is no pace yet. A time field left half typed reports no
 * text at all, so the draft holds that it is half typed beside it.
 */
export type PaceDraft = { kind: 'skill' } | { kind: 'work' } | { kind: 'every'; count: string; unit: PaceUnit; at: string; atHalfTyped?: true }

/** The draft a command's Edit box opens with: its pace on this machine, the skill's own where nobody set one or the one set cannot be followed. */
export function draftOf(command: SchedulerCommand): PaceDraft {
  const pick = command.pace
  if (pick === undefined) return { kind: 'skill' }
  // "Whenever there is work" is what a skill with a check and no interval says already.
  if ('work' in pick && pick.work === true) return command.when !== undefined && command.every !== undefined ? { kind: 'work' } : { kind: 'skill' }
  const every = 'every' in pick ? parseInterval(pick.every) : undefined
  if (!every || !('every' in pick)) return { kind: 'skill' }
  const at = takesTimeOfDay(every) && pick.at !== undefined ? parseTimeOfDay(pick.at) : undefined
  return { kind: 'every', count: String(every.count), unit: every.unit, at: at?.text ?? '' }
}

/**
 * What a draft is on the command line, after `pace <command>`: `skill`, `work`, or an interval
 * with its time of day when it has one. Nothing while the draft is no pace yet: a count that is
 * no whole number above 0, a time that is none. A time typed beside minutes or hours is left out,
 * since the page hides the field then.
 */
export function paceArgs(draft: PaceDraft): string[] | undefined {
  if (draft.kind !== 'every') return [draft.kind]
  const every = /^\d+$/.test(draft.count.trim()) ? parseInterval(`${draft.count.trim()}${draft.unit}`) : undefined
  if (!every) return undefined
  if (!takesTimeOfDay(every)) return [every.text]
  if (draft.atHalfTyped) return undefined
  if (draft.at.trim() === '') return [every.text]
  const at = parseTimeOfDay(draft.at.trim())
  return at ? [every.text, at.text] : undefined
}

/** What keeps a draft from being a pace yet, for the person typing it; nothing when it is one. */
export function paceProblem(draft: PaceDraft): string | undefined {
  if (paceArgs(draft)) return undefined
  if (draft.kind === 'every' && !(/^\d+$/.test(draft.count.trim()) && parseInterval(`${draft.count.trim()}${draft.unit}`))) return `Type a whole number, from 1 to ${MAX_COUNT}.`
  return 'Finish the time, like 10:00, or clear it.'
}

/** A command as it would read with a draft saved: what the Edit box's sentence describes. The command as it is while the draft is no pace yet. */
export function withDraft(command: SchedulerCommand, draft: PaceDraft): SchedulerCommand {
  const args = paceArgs(draft)
  if (!args) return command
  const { pace: _pace, ...rest } = command
  if (args[0] === 'skill') return rest
  return { ...rest, pace: args[0] === 'work' ? { work: true } : { every: args[0]!, ...(args[1] !== undefined ? { at: args[1] } : {}), since: '' } }
}

/** How many runs of a scheduled command may be in flight at once, as this machine counts: the number set here, else the skill's, one when it says none. */
export function atOnce(command: SchedulerCommand): number {
  return command.agents ?? command.skillAgents ?? 1
}

/** Whether a command's number of agents at once is worth saying: when it is more than one, or a person set it, even to one. */
export function saysAtOnce(command: SchedulerCommand): boolean {
  return atOnce(command) > 1 || command.agents !== undefined
}

/** A number of agents at once, as a sentence: "One at a time", "Up to 3 at once". */
export function atOnceWords(count: number): string {
  return count === 1 ? 'One at a time' : `Up to ${count} at once`
}

/** A number of agents at once as the Edit box holds it while a person picks: the skill's own, or a count as typed. */
export type AgentsDraft = { kind: 'skill' } | { kind: 'own'; count: string }

/** The draft a command's Edit box opens with: its number on this machine, the skill's own where nobody set one. */
export function agentsDraftOf(command: SchedulerCommand): AgentsDraft {
  return command.agents === undefined ? { kind: 'skill' } : { kind: 'own', count: String(command.agents) }
}

/** What a draft is on the command line, after `agents <command>`: `skill`, or the count. Nothing while the count is no whole number from 1 to 99. */
export function agentsArgs(draft: AgentsDraft): string[] | undefined {
  if (draft.kind === 'skill') return ['skill']
  const typed = draft.count.trim()
  return /^\d+$/.test(typed) && isAgents(Number(typed)) ? [String(Number(typed))] : undefined
}

/** A command as it would read with a number of agents draft saved; the command as it is while the draft is no number yet. */
export function withAgentsDraft(command: SchedulerCommand, draft: AgentsDraft): SchedulerCommand {
  const args = agentsArgs(draft)
  if (!args) return command
  const { agents: _agents, ...rest } = command
  return args[0] === 'skill' ? rest : { ...rest, agents: Number(args[0]) }
}

/**
 * How far a scheduled command's runs may publish on this machine, as a sentence. It says a limit,
 * not what a run will do: a run with nothing to commit commits nothing. With no level picked the
 * run is told none, and does what its skill says, or its prompt for a row a person made.
 */
export function publishes(command: SchedulerCommand): string {
  if (command.publish === 'commit') return 'May commit, pushes nothing'
  if (command.publish === 'branch') return 'May publish its branch'
  if (command.publish === 'pr') return 'May open a pull request'
  if (command.publish === 'merge') return 'May open a pull request that merges on green'
  return isOwn(command) ? 'As its prompt says' : 'As its skill says'
}

/**
 * What the scheduler last decided for a scheduled command, for a person. A command the coding
 * agent cannot run says so whatever its switch: switching it on would start nothing. Then nothing
 * for a command switched off here, whose row says "Off", for one switched on that no tick has
 * decided yet, and for one the tick started, whose row says when it last ran. A decision is said in
 * plain words where the tool's own are a rule's shorthand ("No work", "One is already running"),
 * and in the tool's words with a capital where they carry a reason only the tool knows
 * (`Quota: …`, `Check failed: …`). A command whose wait is not over says when it starts next:
 * "Next start in 3h, if there is work", "Next start Saturday 10:00".
 */
export function decided(command: SchedulerCommand, now: Date = new Date()): string | undefined {
  const elsewhere = cannotRun(command)
  if (elsewhere) return elsewhere
  // Whether the row's agent can read its skill is said off the files, as of now: the last look's word on it may be about another agent, picked away since.
  if (!command.on || command.decision?.outcome.startsWith('not a command of ')) return undefined
  return waitingWords(command, now) ?? outcomeWords(command.decision?.outcome)
}

/**
 * What a command whose last look found its wait not over says: when it starts next, in the words
 * its Edit panel uses. A look that named the time it is due from (a pace with a time of day) is
 * taken at its word; else the time left is counted from the row's last start, as of now. Nothing
 * for any other decision.
 */
function waitingWords(command: SchedulerCommand, now: Date): string | undefined {
  const outcome = command.decision?.outcome
  if (outcome === undefined || !/^not due \((last start|next start from) /.test(outcome)) return undefined
  const named = /^not due \(next start from (\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d),/.exec(outcome)
  const from = named && new Date(Number(named[1]), Number(named[2]) - 1, Number(named[3]), Number(named[4]), Number(named[5]))
  if (from && from.getTime() > now.getTime()) return `Next start ${nextWords(from, now)}${command.when !== undefined ? ', if there is work' : ''}`
  return nextStart(command, now)
}

/** That the coding agent a row's runs are on cannot run it at all, for a person: its skill is not in that agent's own skills folder. Nothing for a row it can run, and for a row that resumes: each run is on its own agent, and the scheduler says so of a run whose agent cannot. */
export function cannotRun(command: Pick<SchedulerCommand, 'home' | 'runsOn' | 'able' | 'resumes'>): string | undefined {
  if (command.resumes) return undefined
  const agent = agentOf(command)
  return command.able.includes(agent) ? undefined : notThere(AGENT_LABELS[agent], AGENT_SKILLS_DIR[agent])
}

const notThere = (agent: string, dir: string): string => `Cannot start on ${agent}: its skill is not in ${dir}`

/** One decision of the scheduler, a tick's or the answer to "Run now", for a person; nothing for one the row already says in another place: that it is switched off, that it started. A wait that is not over is said by {@link decided}, which knows the row. */
export function outcomeWords(outcome: string | undefined): string | undefined {
  if (outcome === undefined || outcome === 'switched off on this machine' || outcome.startsWith('started ') || outcome.startsWith('resumed ')) return undefined
  // A row that resumes says why of each run it did not: the reason is said as any other.
  const notResumed = /^run \S+ not resumed: (.*)$/.exec(outcome)
  if (notResumed) return outcomeWords(notResumed[1]!)
  const elsewhere = /^not a command of (.+?): its skill is only under .+, not (\S+)$/.exec(outcome)
  if (elsewhere) return notThere(elsewhere[1]!, elsewhere[2]!)
  if (outcome === 'not due') return 'No work'
  const unpublished = /^not on (\S+?)( as this clone last saw it)?: /.exec(outcome)
  if (unpublished) return unpublished[1] === 'HEAD' ? 'Cannot start yet: its skill is not committed' : `Cannot start yet: its skill is not on ${unpublished[1]}${unpublished[2] ? ', as this machine last saw it' : ''}`
  const capped = /^cap reached \((\d+) in flight/.exec(outcome)
  if (capped) return capped[1] === '1' ? 'One is already running' : `${capped[1]} are already running`
  return sentence(outcome)
}

/** A stretch of time still to wait, for a person: "12 min", "3h", "2 days". */
function waitWords(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)} days`
}

/**
 * When a command that is switched on starts next, for a person, by the same two things the
 * Edit panel says a row runs by: what it waits for, and how long it waits after a start. While
 * the wait is not over: "Next start in 3h", or the time it is due from when its pace has a time of
 * day ("Next start tomorrow 10:00"), with ", if there is work" for a row with a shell line. Once
 * the wait is over, or with no wait: "Starts when there is work" for a row with a shell line,
 * which the scheduler asks every minute; a row that runs by time alone starts at the scheduler's
 * next look. Counted from the row's last start as the scheduler lists it, like the scheduler's own.
 */
export function nextStart(command: SchedulerCommand, now: Date = new Date()): string {
  const work = command.when !== undefined
  const soon = work ? 'Starts when there is work' : "Starts at the scheduler's next look"
  const skills = command.every === undefined ? undefined : parseInterval(command.every)
  const inForce = paceInForce(command.pace, { ...(skills ? { every: skills } : {}), ...(command.when !== undefined ? { when: command.when } : {}) })
  if (!inForce) return soon
  const last = command.lastRun === undefined ? undefined : new Date(command.lastRun.at)
  const from = dueFrom(inForce, last, now)
  if (from.getTime() <= now.getTime()) return soon
  const when = inForce.at ? nextWords(from, now) : `in ${waitWords(from.getTime() - now.getTime())}`
  return `Next start ${when}${work ? ', if there is work' : ''}`
}

/**
 * What a command that is switched on says of its next start, in one line. Why it cannot start,
 * where the scheduler's last look gave a reason only the tool knows (the quota, a check that
 * failed, enough of it running already, a skill that is not where a run starts); else when it
 * starts next, by its pace ({@link nextStart}).
 */
export function startsNext(command: SchedulerCommand, now: Date = new Date()): string {
  const elsewhere = cannotRun(command)
  if (elsewhere) return elsewhere
  const outcome = command.decision?.outcome
  // What the last look said of the pace or of the work is said better by the pace itself, as of now.
  const paced = outcome === undefined || outcome === 'not due' || outcome.startsWith('not due (') || outcome.startsWith('started ') || outcome === 'switched off on this machine'
  return (paced ? undefined : decided(command, now)) ?? nextStart(command, now)
}

/** Why nothing starts by itself in a project though rows are switched on, in a sentence; nothing while its scheduler is on and running. */
export function schedulerStopped(row: Pick<SchedulerRow, 'on' | 'running'>): string | undefined {
  if (!row.on) return 'The scheduler is off'
  if (!row.running) return 'The scheduler is on, but not running'
  return undefined
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A coming local time, for a person: "today 10:00", "tomorrow 10:00", the weekday within a week ("Saturday 10:00"), else the date ("24 Oct 10:00"). A time already past, read off an old tick, is "as soon as the scheduler looks". */
export function nextWords(when: Date, now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  if (when.getTime() <= now.getTime()) return 'as soon as the scheduler looks'
  const time = `${two(when.getHours())}:${two(when.getMinutes())}`
  const days = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  if (days > 1 && days < 7) return `${WEEKDAYS[when.getDay()]} ${time}`
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${time}`
}

/** The one word a scheduler's row leads with, and its colour. */
export function schedulerStatus(row: Pick<SchedulerRow, 'error' | 'on' | 'running'>): { label: string; tone: string } {
  if (row.error !== undefined) return { label: 'not readable', tone: 'text-danger' }
  if (!row.on) return { label: 'off', tone: 'text-muted-foreground' }
  if (!row.running) return { label: 'on, not running', tone: 'text-warning' }
  return { label: 'on', tone: 'text-success' }
}
