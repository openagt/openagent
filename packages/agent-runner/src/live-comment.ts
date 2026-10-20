import { createRequire } from 'node:module'
import type { DriverEvent, DriverModel, LogEndStatus, PlanTask } from '@openagt/agent-driver'
import type { GitHost } from './git-host.js'

/**
 * The comment a run a row resumed keeps on its pull request while it works (#2042): posted as the
 * run begins, rewritten as it goes, and at the end the agent's last message, its answer, in the
 * same comment. Whoever wrote on the pull request sees within the minute that an agent is on it,
 * and what it does, without the dashboard. This process writes it, not the agent: it sees every
 * step, and an agent told to keep a comment up to date spends turns on it, and forgets.
 *
 * While the run works: the coding agent's logo, "<agent> is working…" and OpenAgent's moving logo,
 * then a checklist that only grows, so the comment does not jump as it is rewritten. The checklist is the agent's own plan, its tasks ticked as it does them; an
 * agent that made none has its steps instead, each ticked once over: the coding agent's own words
 * for a call ("Read the PR's discussion"), else the calls counted ("Ran 2 commands"). The commands,
 * the paths and what the agent said on the way stay on this machine: the pull request may be public.
 * Once it ended: "<agent> finished @<login>'s task in 22s", the model, the effort and the branch,
 * a rule, the checklist, then the answer.
 *
 * Its pictures are this package's `assets`, at the version of this package that wrote the comment,
 * as the npm registry serves them through jsDelivr: a comment keeps its pictures however the
 * package changes later. The git host marks what it writes for this, so a check never counts it as
 * the person's own words, though it is posted with their account.
 */

/** The least time between two rewrites of the comment: GitHub limits how often an account writes. A change after a quiet spell is written at once. */
export const REWRITE_EVERY_MS = 5_000

/** The newest steps the comment shows; the earlier ones are counted. */
export const STEPS_SHOWN = 20

/** The longest answer the comment holds: GitHub takes 65,536 characters, the checklist needs the rest. */
export const ANSWER_MAX = 60_000

/** The longest reason a failure shows; the record keeps the whole. */
const REASON_MAX = 2_000

/** Where this package's pictures are served from: its own version's, on the npm registry. */
export const ASSETS_URL = `https://cdn.jsdelivr.net/npm/@openagt/agent-runner@${(createRequire(import.meta.url)('../package.json') as { version: string }).version}/assets`

/** The coding agents' names and logos; another agent is named by its id, with no logo. */
const AGENTS: Record<string, { name: string; logo: string }> = {
  'claude-code': { name: 'Claude Code', logo: `<img src="${ASSETS_URL}/claude.svg" width="16" height="16" align="top" alt="">` },
  codex: { name: 'Codex', logo: `<picture><source media="(prefers-color-scheme: dark)" srcset="${ASSETS_URL}/codex-dark.svg"><img src="${ASSETS_URL}/codex-light.svg" width="16" height="16" align="top" alt=""></picture>` },
}

/** OpenAgent's moving logo, after "is working…". */
const WORKING = `<img src="${ASSETS_URL}/working.svg" width="24" height="24" align="top" alt="">`

/** What the run is on, and for whom. */
export interface RunsOn {
  /** The coding agent's id: `claude-code`, `codex`. */
  agent: string
  /** The model's id, an alias or the full one its agent named once started. */
  model?: string
  effort?: string
  /** The logins of the people whose words woke the run. */
  from?: string[]
}

/** One step of a run with no plan: its words, and whether every call it counts is over. */
export interface Step {
  words: string
  done: boolean
}

/** What the comment shows: the run, the agent's names for its models, and its plan or its steps. */
export interface LiveView {
  on: RunsOn
  models: readonly DriverModel[]
  plan?: readonly PlanTask[]
  steps: readonly Step[]
}

/** How the run ended, as the comment says it. */
export interface Ending {
  status: LogEndStatus
  /** The agent's last message: the answer. */
  text: string
  /** Why it failed or stopped. */
  detail?: string
  /** The branch the work is on, with its page when the git host has one. */
  branch?: { name: string; url?: string }
  ms: number
}

/** "45s", "2m 13s", "1h 4m". */
export function durationWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Whose task it was: "@rom's", "@rom and @dani's", "@rom, @dani and @lee's"; "the" for nobody's. */
export function whoseTask(from: readonly string[] = []): string {
  const names = from.map(login => `@${login}`)
  if (names.length === 0) return 'the'
  return `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}'s`
}

/** The checklist: the agent's plan, else its steps, the newest {@link STEPS_SHOWN} with the earlier ones counted; none before either. */
function checklist(view: LiveView, allOver: boolean): string | undefined {
  if (view.plan && view.plan.length > 0) return ['**Todo list**', ...view.plan.map(task => `- [${task.status === 'completed' ? 'x' : ' '}] ${task.text}`)].join('\n')
  if (view.steps.length === 0) return undefined
  const shown = view.steps.slice(-STEPS_SHOWN)
  const earlier = view.steps.length - shown.length
  return ['**Steps**', ...(earlier > 0 ? [`- [x] …${earlier} earlier`] : []), ...shown.map(step => `- [${step.done || allOver ? 'x' : ' '}] ${step.words}`)].join('\n')
}

/** The comment's text: working with its checklist, or, given its ending, the head, the checklist and the answer. */
export function liveBody(view: LiveView, ending?: Ending): string {
  const agent = AGENTS[view.on.agent]
  const name = agent?.name ?? view.on.agent
  const logo = agent ? `${agent.logo} ` : ''
  if (!ending) {
    const list = checklist(view, false)
    return [`${logo}**${name} is working…** ${WORKING}`, ...(list ? [list] : [])].join('\n\n')
  }

  const took = durationWords(ending.ms)
  const failed = ending.status === 'failed'
  const stopped = ending.status === 'stopped'
  const head = failed ? `**${name} encountered an error after ${took}**` : stopped ? `**${name} was stopped after ${took}**` : `**${name} finished ${whoseTask(view.on.from)} task in ${took}**`
  const model = view.on.model !== undefined ? (view.models.find(m => m.id === view.on.model || m.resolvedId === view.on.model)?.name ?? view.on.model) : undefined
  const runsOn = [...(model !== undefined ? [model] : []), ...(view.on.effort !== undefined ? [`${view.on.effort} effort`] : [])].join(' · ')
  const branch = ending.branch ? (ending.branch.url ? `[\`${ending.branch.name}\`](${ending.branch.url})` : `\`${ending.branch.name}\``) : ''
  const links = [runsOn, branch].filter(part => part !== '')
  const parts = [`${logo}${head}${links.length > 0 ? ` —— ${links.join(' • ')}` : ''}`]
  if (failed && ending.detail?.trim()) {
    const reason = ending.detail.trim().replaceAll('```', "'''")
    parts.push(`\`\`\`\n${reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX)}…` : reason}\n\`\`\``)
  }
  parts.push('---')
  // A run that ended done had every call it made over; one that failed or was stopped keeps what it left open.
  const list = checklist(view, !failed && !stopped)
  if (list) parts.push(list)
  const answer = failed || stopped ? '' : ending.text.trim()
  if (answer) parts.push(answer.length > ANSWER_MAX ? `${answer.slice(0, ANSWER_MAX)}\n\n(cut: the answer is ${answer.length} characters, these are the first ${ANSWER_MAX})` : answer)
  return parts.join('\n\n')
}

/** What a run's live comment is told. */
export interface LiveComment {
  /** One of the agent's events: its plan, a step of its own or the end of one, and the comment is rewritten soon. */
  onEvent(event: DriverEvent): void
  /** The run ended: the comment says how, with the answer, and the branch the work is on. Resolves once it is written, or could not be. */
  end(ending: Omit<Ending, 'ms' | 'branch'> & { branch?: string }): Promise<void>
}

/**
 * Post the run's comment on pull request `number`, for a run on `on`, and keep it. The post is not
 * waited for: the run starts beside it. A comment that could not be posted is not rewritten on the
 * way; its ending is then posted as a new one, so the answer still reaches the pull request. A
 * failed write is a line in the log, never the run's failure.
 */
export function openLiveComment(repo: string, number: number, on: RunsOn, deps: { gitHost: GitHost; log: (line: string) => void; models?: Promise<DriverModel[]>; now?: () => number; everyMs?: number }): LiveComment {
  const now = deps.now ?? Date.now
  const everyMs = deps.everyMs ?? REWRITE_EVERY_MS
  const began = now()
  const view: { on: RunsOn; models: readonly DriverModel[]; plan?: readonly PlanTask[]; steps: { words: string; calls: number; open: number }[] } = { on: { ...on }, models: [], steps: [] }
  // The agent's names for its models, asked beside the post: until they come, a model is named by its id.
  void deps.models?.then(
    listed => void (view.models = listed),
    () => {},
  )
  // Which step each call still going is in, by the call's id; and whether the last step counts calls the agent gave no words of their own.
  const going = new Map<string, (typeof view.steps)[number]>()
  let counting = false
  let id: string | undefined
  let ended = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastRewrite = -Infinity
  // Once the agent's turn is over the ending follows within a second or two: no rewrite in between.
  let settling = false
  const body = (ending?: Ending): string => liveBody({ ...view, steps: view.steps.map(step => ({ words: step.words, done: step.open === 0 })) }, ending)

  // One write at a time, in order: a rewrite never overtakes the post, nor the ending a rewrite.
  let writing = Promise.resolve()
  const write = (text: () => string, posting: boolean): Promise<void> =>
    (writing = writing.then(async () => {
      if (!posting && id === undefined) return
      const written = await deps.gitHost.comment(repo, id !== undefined ? { edit: id } : { number }, text()).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
      if ('error' in written) deps.log(`[agent-runner] the comment on pull request ${number} could not be written: ${written.error}`)
      else id ??= written.id
    }))
  // Events that come together are one rewrite; one after a quiet spell is written at once.
  const soon = (): void => {
    if (settling || timer !== undefined) return
    timer = setTimeout(
      () => {
        timer = undefined
        lastRewrite = now()
        void write(() => body(), false)
      },
      Math.max(0, lastRewrite + everyMs - now()),
    )
    timer.unref?.()
  }

  void write(() => body(), true)

  return {
    onEvent(event) {
      // The full id the agent runs, once it says: the alias it was given may move on.
      if (event.type === 'model') view.on.model = event.model
      if (ended) return
      if (event.type === 'result') {
        settling = true
        clearTimeout(timer)
        timer = undefined
        return
      }
      // A turn the inbox goes on to send works again.
      if (event.type === 'start') settling = false
      if (event.type === 'plan') {
        view.plan = event.tasks
        soon()
      } else if (event.type === 'action' && event.subagent === undefined) {
        const step = event.summary ? undefined : counting ? view.steps.at(-1) : undefined
        const into = step ?? { words: '', calls: 0, open: 0 }
        if (!step) view.steps.push(into)
        into.calls++
        into.words = event.summary ?? (into.calls === 1 ? 'Ran a command' : `Ran ${into.calls} commands`)
        counting = !event.summary
        // A call with no id is never said over: it counts as over at once.
        if (event.id !== undefined) {
          into.open++
          going.set(event.id, into)
        }
        soon()
      } else if (event.type === 'output' && going.has(event.id)) {
        going.get(event.id)!.open--
        going.delete(event.id)
        soon()
      }
    },

    async end({ branch, ...ending }) {
      // Once: a run that ended and failed after, in its record or its reclaim, keeps the ending it had.
      if (ended) return
      ended = true
      clearTimeout(timer)
      timer = undefined
      const url = branch !== undefined ? await deps.gitHost.branchUrl(repo, branch).catch(() => undefined) : undefined
      await write(() => body({ ...ending, ...(branch !== undefined ? { branch: { name: branch, ...(url !== undefined ? { url } : {}) } } : {}), ms: now() - began }), true)
    },
  }
}
