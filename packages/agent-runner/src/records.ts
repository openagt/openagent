import { isSkillName, type FileBranchWrite } from '@openagt/agent-data'
import type { ProjectSkillsPick } from './agent.js'
import { publishedBranch } from '@openagt/agent-data/names'
import { deleteRun, writeRun, type AnyDiaryLine, type LogsDeps, type RunCard } from '@openagt/skill-logs'

/**
 * A run in flight is a run record (#1774): the `logs` skill's card on the project's `agent-data`
 * branch, written before the agent is spawned with `status: running` and this tool's own mark
 * under `caller`, and written again when the run ends — same id, same file — with how it went.
 * One file for the run's whole life, and every machine that shares the branch reads the same
 * running cards (a scheduler counts them against its caps). No pid is held anywhere: a restart
 * loses nothing.
 *
 * A running card from another machine is that machine's: only its own sweep, or a person, changes
 * it. A machine that never comes back leaves its card running, on purpose: nothing here guesses that a run it cannot see is dead.
 */

/** How far a run takes its work when its agent finishes: a commit, its branch pushed, its pull request, or the request set to merge once its checks pass. */
export const PUBLISH_LEVELS = ['commit', 'branch', 'pr', 'merge'] as const
export type Publish = (typeof PUBLISH_LEVELS)[number]

export function isPublish(value: unknown): value is Publish {
  return (PUBLISH_LEVELS as readonly unknown[]).includes(value)
}

/** The word that takes a run's level away on a resume or a message (`--publish nothing`): from there on its prompt goes as written. */
export const NO_PUBLISH = 'nothing'

/**
 * A level a run is given part way, by a resume or a message (`--publish`, an inbox line's
 * `publish`): one of the levels, or `null` for {@link NO_PUBLISH}; any other word is no change.
 */
export function publishChange(word: string | undefined): Publish | null | undefined {
  return isPublish(word) ? word : word === NO_PUBLISH ? null : undefined
}

/** This tool's mark on a card, under `caller.runner`. */
export interface RunnerMark extends Lasting {
  /** The machine that started it. */
  host: string
  /** The run's process on that machine, while it runs. */
  pid?: number
  /** Who resumed the run last, and when (`run --resume --by`): a scheduler's row, which counts the run as its own from then on. Not kept past the next resume. */
  resumed?: { by: string; at: string }
}

/**
 * What a mark keeps for the run's whole life, a resume included: its publish level, its parent,
 * where it started, where its pull request goes, the account it works as, what it was started for,
 * the repos it has, its agent and the session's picks of skills.
 */
export interface Lasting {
  /** How far the run takes its work when its agent finishes (`run --publish`): a commit, the branch, its pull request, or the request set to merge; absent, only what its prompt asks. */
  publish?: Publish
  /** The run this one was started for, told when this one ends (`run --parent`). */
  parent?: string
  /** What this run's own branch started from (`run --base`): a branch of this clone, or origin's copy of one (`publishedBase`); origin's default branch when absent. */
  base?: string
  /** The branch the run's pull request goes into (`run --pr-base`); the repository's default branch when absent. */
  prBase?: string
  /** The account the run worked as at the git host, last time it ran. */
  gitAccount?: string
  /** The commit this run's own branch was made at: where the run's own work begins. Absent for a run given a branch that existed. */
  baseCommit?: string
  /** What the run was started for, as whoever started it names it (`run --for`): a thread on the git host, its address, so the next call there finds this run. */
  for?: string
  /** The repos a session with no project has as context (`run --repos`), each a copy in its folder. */
  repos?: SessionRepo[]
  /** The agent the run is on, by its id (`OPENAGENT_AGENT`): its skills and accounts; the default agent when absent. */
  agent?: string
  /** Skills the run gets on top of its agent's (`OPENAGENT_SKILLS_ON`): the session's pick. */
  skillsOn?: string[]
  /** Skills of its agent's the run does not get (`OPENAGENT_SKILLS_OFF`): the session's pick. */
  skillsOff?: string[]
  /** Which of the project's own skills stay in the run's checkout (`OPENAGENT_PROJECT_SKILLS`): none, or the ones named; every one when absent. */
  projectSkills?: ProjectSkillsPick
}

/**
 * A repo a session with no project has as context: the folder it was copied from, and the name
 * of its copy in the session's folder.
 */
export interface SessionRepo {
  name: string
  from: string
}

/** The repos a mark names, as far as they are repos: anything else there is left out. */
function reposOf(value: unknown): SessionRepo[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap(repo => (repo && typeof repo === 'object' && typeof repo.name === 'string' && typeof repo.from === 'string' ? [{ name: repo.name as string, from: repo.from as string }] : []))
}

/** The mark a card carries, or `undefined` for a run this tool did not start. */
export function runnerMark(card: RunCard): RunnerMark | undefined {
  const mark = card.caller?.['runner']
  if (!mark || typeof mark !== 'object') return undefined
  const { host, pid, resumed } = mark as Record<string, unknown>
  if (typeof host !== 'string') return undefined
  const by = resumed && typeof resumed === 'object' ? (resumed as Record<string, unknown>) : {}
  return { host, ...(typeof pid === 'number' ? { pid } : {}), ...lasting(mark as Record<string, unknown>), ...(typeof by['by'] === 'string' && typeof by['at'] === 'string' ? { resumed: { by: by['by'], at: by['at'] } } : {}) }
}

/**
 * The pull requests the run opened before the one its card names, oldest first, under
 * `caller.earlierPrs`: a run that moved its work to a new branch opened a request for each, and
 * the card's own `pr` is only the last.
 */
export function earlierPrs(card: RunCard): { number: number; url: string }[] {
  const prs = card.caller?.['earlierPrs']
  if (!Array.isArray(prs)) return []
  return prs.flatMap(pr => (pr && typeof pr === 'object' && typeof pr.number === 'number' && typeof pr.url === 'string' ? [{ number: pr.number as number, url: pr.url as string }] : []))
}

/** A list of skill names, as a mark keeps one; nothing for anything else, or an empty list. */
const skillNames = (value: unknown): string[] | undefined => (Array.isArray(value) && value.length > 0 && value.every(isSkillName) ? (value as string[]) : undefined)

/** What `mark` keeps for the run's whole life ({@link Lasting}), as far as each is what it should be: anything else there is left out. */
export function lasting(mark: { [K in keyof Lasting]?: unknown }): Lasting {
  const repos = reposOf(mark.repos)
  const skillsOn = skillNames(mark.skillsOn)
  const skillsOff = skillNames(mark.skillsOff)
  const projectSkills = mark.projectSkills === 'none' ? 'none' : skillNames(mark.projectSkills)
  return {
    ...(isPublish(mark.publish) ? { publish: mark.publish } : {}),
    ...(typeof mark.parent === 'string' ? { parent: mark.parent } : {}),
    ...(typeof mark.base === 'string' ? { base: mark.base } : {}),
    ...(typeof mark.prBase === 'string' ? { prBase: mark.prBase } : {}),
    ...(typeof mark.gitAccount === 'string' ? { gitAccount: mark.gitAccount } : {}),
    ...(typeof mark.baseCommit === 'string' ? { baseCommit: mark.baseCommit } : {}),
    ...(typeof mark.for === 'string' ? { for: mark.for } : {}),
    ...(repos !== undefined && repos.length > 0 ? { repos } : {}),
    ...(typeof mark.agent === 'string' && mark.agent ? { agent: mark.agent } : {}),
    ...(skillsOn ? { skillsOn } : {}),
    ...(skillsOff ? { skillsOff } : {}),
    ...(projectSkills !== undefined ? { projectSkills } : {}),
  }
}

/** The card a run starts with. */
export function markerCard(run: { id: string; startedAt: string; prompt: string; driver: string; model?: string; mark: RunnerMark }): RunCard {
  return {
    id: run.id,
    startedAt: run.startedAt,
    status: 'running',
    intent: run.prompt,
    driver: run.driver,
    ...(run.model !== undefined ? { model: run.model } : {}),
    // `host` as the run's live card has it too: a reader tells this machine's runs from another's by it.
    caller: { runner: run.mark, host: run.mark.host, ...forReaders(run.mark) },
  }
}

/**
 * What a reader of the card finds beside `host`, outside this tool's mark: the run's parent, the
 * name of the branch it was started from when it was told one, the branch its pull request goes into, the account it worked as at the git host, the commit its own work begins at, which its
 * changes are measured from, and how far it takes its work, which a dashboard shows and offers to
 * change, and what it was started for, which a git host's check reads to find the run a thread has,
 * and the repos a session with no project has, which its page shows.
 */
export function forReaders(mark: Lasting): Lasting {
  return {
    ...(mark.parent !== undefined ? { parent: mark.parent } : {}),
    ...(mark.base !== undefined ? { base: publishedBranch(mark.base) ?? mark.base } : {}),
    ...(mark.prBase !== undefined ? { prBase: mark.prBase } : {}),
    ...(mark.gitAccount !== undefined ? { gitAccount: mark.gitAccount } : {}),
    ...(mark.baseCommit !== undefined ? { baseCommit: mark.baseCommit } : {}),
    ...(mark.publish !== undefined ? { publish: mark.publish } : {}),
    ...(mark.for !== undefined ? { for: mark.for } : {}),
    ...(mark.repos !== undefined ? { repos: mark.repos } : {}),
    ...(mark.agent !== undefined ? { agent: mark.agent } : {}),
    ...(mark.skillsOn !== undefined ? { skillsOn: mark.skillsOn } : {}),
    ...(mark.skillsOff !== undefined ? { skillsOff: mark.skillsOff } : {}),
    ...(mark.projectSkills !== undefined ? { projectSkills: mark.projectSkills } : {}),
  }
}

/** What the reclaim of a run's checkout is told: the commit its branch was made at, when its mark names one. */
export function startOf(card: RunCard): { from?: string } {
  const from = runnerMark(card)?.baseCommit
  return from !== undefined ? { from } : {}
}

/** Put the run's card on the branch before its agent exists. The outcome says whether it reached origin. */
export function writeMarker(repo: string, card: RunCard, deps: LogsDeps = {}): Promise<FileBranchWrite> {
  return writeRun(repo, card, [], deps)
}

/** Take a marker back: a scheduler lost a cap to another machine's marker, so this run never starts. */
export function withdrawMarker(repo: string, id: string, deps: LogsDeps = {}): Promise<FileBranchWrite> {
  return deleteRun(repo, id, deps)
}

/** Record how a run went: its card and its diary, over the marker. */
export function recordRun(repo: string, card: RunCard, diary: readonly AnyDiaryLine[], deps: LogsDeps = {}): Promise<FileBranchWrite> {
  return writeRun(repo, card, diary, deps)
}

/**
 * Record a run again without its branch when the reclaim deleted that branch: one that held
 * nothing goes with its checkout, and the record must not name a branch that is gone. Written
 * after the reclaim rather than reclaiming first, so the record never says `running` with no
 * checkout behind it. Nothing is written when the branch stayed.
 */
export async function recordBranchGone(repo: string, card: RunCard, diary: readonly AnyDiaryLine[], deleted: readonly string[] | undefined, deps: LogsDeps = {}): Promise<FileBranchWrite | undefined> {
  if (card.branch === undefined || !deleted?.includes(card.branch)) return undefined
  const branchless: RunCard = { ...card }
  delete branchless.branch
  return recordRun(repo, branchless, diary, deps)
}
