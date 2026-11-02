import type { OpenAgentEvent } from '../../src/index.js'

// The files an agent's edits changed, turn by turn, off the log: each edit's own account of what
// it did to its file (the `changed` of a tool call's output), summed for each file of a turn.
// A file changed by a shell command is no edit and is not here: the Changes pane lists it.

/** One file a turn's edits changed. */
export interface ChangedFile {
  /** The file's path in the agent's checkout, as the Changes pane names it. */
  path: string
  /** The path's last part: what the row reads. */
  name: string
  added: number
  removed: number
  /** An edit of the turn made the file. */
  created: boolean
}

/** A path inside the agent's checkout, said from the checkout: the coding agents name a file by its whole path. */
export function inCheckout(path: string, workspace: string | undefined): string {
  const root = workspace?.replace(/\/+$/, '')
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/**
 * Whether an edit is one of the run's changes at all: a file the agent wrote **outside** its
 * checkout is not. The agents name a file by its whole path, and an agent writes outside its
 * checkout often enough that this is not an edge case — the orchestration skill tells it to save
 * its plan "to a markdown file outside your checkout", so every orchestrated run reports one.
 * Such a row read as a change of the project, named by its bare last part, and opened nothing:
 * the panes read a file of the project, and a path outside it is refused on purpose.
 *
 * Only an absolute path can be judged this way. A relative one is the checkout's by definition and
 * is kept, and so is everything when the checkout is not known, which leaves a run whose record
 * carries no workspace reading as it did before.
 */
export function inProject(path: string, workspace: string | undefined): boolean {
  const root = workspace?.replace(/\/+$/, '')
  return root === undefined || !path.startsWith('/') || path.startsWith(`${root}/`)
}

/** What an event says its tool call changed, if it is the output of one that changed a file. */
function changedBy(e: OpenAgentEvent): readonly FileEdit[] {
  return e.kind === 'driver' && e.event.type === 'output' ? (e.event.changed ?? []) : []
}

function isPrompt(e: OpenAgentEvent): boolean {
  return e.kind === 'driver' && e.event.type === 'start'
}

/** What one edit says it did to one file, as its coding agent reports it. */
export interface FileEdit {
  path: string
  added: number
  removed: number
  created?: true
}

/**
 * The files a run of edits changed, in the order first changed, each once with its edits summed.
 * What the agent wrote outside its checkout is left out ({@link inProject}).
 * A file one of the edits made holds, at the end, the lines the edits added less the ones they
 * removed again, and it removed none of an earlier file's: "+3 −0" then "+2 −1" is a new file of
 * four lines, "+4 −0". A file that was there before sums its edits as they are.
 */
export function sumEdits(edits: readonly FileEdit[], workspace?: string | undefined): ChangedFile[] {
  const files = new Map<string, ChangedFile>()
  for (const edit of edits) {
    if (!inProject(edit.path, workspace)) continue
    const path = inCheckout(edit.path, workspace)
    const file = files.get(path) ?? { path, name: path.replace(/\/+$/, '').split('/').pop() || path, added: 0, removed: 0, created: false }
    files.set(path, { ...file, added: file.added + edit.added, removed: file.removed + edit.removed, created: file.created || edit.created === true })
  }
  return [...files.values()].map(file => (file.created ? { ...file, added: Math.max(0, file.added - file.removed), removed: 0 } : file))
}

/**
 * The files each turn's edits changed (see {@link sumEdits}): `ended` under the prompt that ended
 * the turn, `last` for the turn no prompt has ended yet. A turn that changed no file has no entry.
 */
export function turnChanges(events: readonly OpenAgentEvent[], workspace: string | undefined): { ended: Map<OpenAgentEvent, ChangedFile[]>; last: ChangedFile[] } {
  const ended = new Map<OpenAgentEvent, ChangedFile[]>()
  let turn: FileEdit[] = []
  for (const e of events) {
    if (isPrompt(e)) {
      if (turn.length > 0) ended.set(e, sumEdits(turn, workspace))
      turn = []
      continue
    }
    turn.push(...changedBy(e))
  }
  return { ended, last: sumEdits(turn, workspace) }
}
