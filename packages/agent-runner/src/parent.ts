import { errorMessage } from '@openagt/agent-data'
import { appendInbox, promptLines, takeInbox, type PromptLine } from '@openagt/agent-driver'
import { worktreePath } from '@openagt/skill-branches'
import { inboxPath, readLiveCard } from './live-card.js'
import { runnerMark } from './records.js'

/**
 * A run started for another run, its parent (`run --parent <id>`), tells the parent when it ends:
 * one line saying which run, how it ended, and its last words. The line reaches the parent the way
 * a person's message reaches a run: into its inbox while it works, as a resume once it has ended.
 * Nothing waits for a child: the parent's agent ends its turn, and the line is its next prompt.
 */

/** How a run ended, as its parent is told. */
export interface ChildEnd {
  id: string
  status: string
  /** Why, when the run did not end well. */
  detail?: string
  /** The question the run stopped on, when it ended waiting. */
  question?: string
  /** The branch the run's work is on, when it still exists. */
  branch?: string
  pr?: { url: string }
  /** The agent's answer on its last turn. */
  lastWords?: string
}

/** The line a parent gets: which run, how it ended, where its work is, and its last words. */
export function childEndedLine(end: ChildEnd): string {
  const lines = [`The run ${end.id}, started for this run, ended ${end.status}${end.detail ? `: ${end.detail}` : ''}.`]
  if (end.question !== undefined) lines.push(`It is waiting on a question: ${end.question.replace(/\s+/g, ' ').trim()}`)
  if (end.branch !== undefined) lines.push(`Its work is on the branch ${end.branch}.`)
  if (end.pr) lines.push(`Its pull request: ${end.pr.url}`)
  const words = end.lastWords?.trim()
  if (words) lines.push('', 'Its last words:', words)
  return lines.join('\n')
}

export interface ParentDeps {
  host: string
  /** Whether a pid is a live process here. */
  isAlive: (pid: number) => boolean
  /** Continue an ended run in its own process, with a text or an answer. Absent, an ended parent is not told. */
  resume?: (id: string, line: { text: string } | { answer: string }) => Promise<void>
  log: (line: string) => void
  /** Whether the parent is working; read off its live card when absent. */
  isWorking?: (repo: string, id: string) => Promise<boolean>
}

/** Whether the run's live card says it is working, on this machine, under a process that is alive. */
async function isRunWorking(repo: string, id: string, deps: Pick<ParentDeps, 'host' | 'isAlive'>): Promise<boolean> {
  const card = await readLiveCard(worktreePath(repo, id), id)
  const mark = card && runnerMark(card)
  return card?.status === 'running' && mark !== undefined && mark.host === deps.host && mark.pid !== undefined && deps.isAlive(mark.pid)
}

/**
 * Hand one line to the parent run. A parent that is working takes it from its inbox when its turn
 * ends. A parent that has ended is continued with it. A parent that ends while the line is on its
 * way would leave it in an inbox nobody reads, so the parent is looked at again after the write,
 * and what is still in the inbox then is taken back and continues the parent instead. Never
 * throws: whatever goes wrong is one line on `log`, and the child ends as it ended.
 */
export async function tellParent(repo: string, parent: string, text: string, deps: ParentDeps): Promise<void> {
  try {
    const isWorking = deps.isWorking ?? ((r: string, id: string) => isRunWorking(r, id, deps))
    let lines: PromptLine[] = [{ kind: 'message', text }]
    if (await isWorking(repo, parent)) {
      const inbox = inboxPath(worktreePath(repo, parent))
      await appendInbox(inbox, lines[0]!)
      if (await isWorking(repo, parent)) return
      lines = promptLines(await takeInbox(inbox))
    }
    if (!deps.resume) return
    for (const stranded of lines) await deps.resume(parent, stranded.kind === 'message' ? { text: stranded.text } : { answer: stranded.answer })
  } catch (err) {
    deps.log(`[agent-runner] the parent run ${parent} could not be told: ${errorMessage(err)}`)
  }
}
