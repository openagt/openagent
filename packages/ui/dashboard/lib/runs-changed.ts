import { useSyncExternalStore } from 'react'
import type { RunsChanged } from '../../src/dashboard-rpc/runs-changed.js'
import type { Again } from './use-async.js'

// The daemon tells the page the moment the runs of a project change, here or on another computer
// (`GET /_rpc/changes`), and the reads that list runs read again at once; and the moment a pull
// request stands otherwise, when the reads that show one (the rows of the runs, a run's own page)
// read again together, so none says "open" of a request another already says is merged. While it tells, those
// reads poll only as a safety, slowly: a told change is never waited for. One stream for the
// whole page, open while a read listens and the tab is shown; `EventSource` opens it again by
// itself when it drops, and every listener reads again then, for what changed meanwhile.

/** How often a read of the runs polls while the daemon tells it of every change. */
export const TOLD_EVERY_MS = 15_000

/** Told a project whose runs changed, or every project (`undefined`) when the stream opened again, and each time a number of its own. */
type Listener = (projectId: string | undefined, turn: number) => void

const listeners = new Set<Listener>()
/** The reads of a run's pull request, told each time a request moved, and when the stream opened again. */
const prListeners = new Set<(turn: number) => void>()
const openListeners = new Set<() => void>()
let stream: EventSource | undefined
let open = false
let opened = false
let turn = 0

function setOpen(now: boolean): void {
  if (open === now) return
  open = now
  for (const listener of [...openListeners]) listener()
}

function tell(projectId: string | undefined): void {
  turn++
  for (const listener of [...listeners]) listener(projectId, turn)
}

/** Everything reads again: what changed while the stream was down, or a pull request that moved, which every list of runs marks too. */
function tellAll(): void {
  tell(undefined)
  for (const listener of [...prListeners]) listener(turn)
}

const listening = (): number => listeners.size + prListeners.size

const shown = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden'

function connect(): void {
  if (stream || typeof EventSource === 'undefined' || listening() === 0 || !shown()) return
  const source = new EventSource('/_rpc/changes')
  stream = source
  source.onopen = () => {
    setOpen(true)
    // Opened again: what changed while it was not is read now.
    if (opened) tellAll()
    opened = true
  }
  source.onerror = () => setOpen(false)
  source.onmessage = message => {
    try {
      const change = JSON.parse(String(message.data)) as RunsChanged
      if (change.kind === 'runs' && typeof change.projectId === 'string') tell(change.projectId)
      else if (change.kind === 'prs') tellAll()
    } catch {
      // A torn message is one change missed, which the next poll reads.
    }
  }
}

function disconnect(): void {
  stream?.close()
  stream = undefined
  // Opened again later, it is for a tab shown again, which reads everything then anyway.
  opened = false
  setOpen(false)
}

if (typeof document !== 'undefined') {
  // A tab not shown reads nothing, so it is told nothing: the daemon stops following for it.
  document.addEventListener('visibilitychange', () => (shown() ? connect() : disconnect()))
}

/**
 * Call `read` each time the runs of `projectId` change (of any project, when it is `undefined`),
 * with the number of that change: reads that share an answer read once per change. Until the
 * answer is called.
 */
export function onRunsChanged(projectId: string | undefined, read: (turn: number) => void): () => void {
  const listener: Listener = (changed, number) => {
    if (changed === undefined || projectId === undefined || changed === projectId) read(number)
  }
  listeners.add(listener)
  connect()
  return () => {
    listeners.delete(listener)
    if (listening() === 0) disconnect()
  }
}

/** Call `read` each time a pull request moved (merged, closed, opened), with the number of that change. Until the answer is called. */
export function onPrsChanged(read: (turn: number) => void): () => void {
  const listener = (number: number): void => read(number)
  prListeners.add(listener)
  connect()
  return () => {
    prListeners.delete(listener)
    if (listening() === 0) disconnect()
  }
}

/** Whether the daemon tells the page of every change of the runs right now. */
function useRunsTold(): boolean {
  return useSyncExternalStore(
    listener => {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    },
    () => open,
    () => false,
  )
}

/** For a read of the runs of `projectId` (of every project, when it is `undefined`): read again at each change. */
export function runsAgain(projectId: string | undefined): Again {
  return read => onRunsChanged(projectId, read)
}

/** For a read that shows a run's pull request: read again each time a request moved. */
export function prsAgain(): Again {
  return read => onPrsChanged(read)
}

/** How often a read of the runs polls: `everyMs`, or slowly while the daemon tells of every change. */
export function useRunsPace(everyMs: number): number {
  return useRunsTold() ? Math.max(everyMs, TOLD_EVERY_MS) : everyMs
}
