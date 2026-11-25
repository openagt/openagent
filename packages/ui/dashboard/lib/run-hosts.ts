import { useEffect, useSyncExternalStore } from 'react'
import { onRunHosts, type RunHostChoice } from '../rpc/projects.js'

// The hosts a run may be picked to run on beside this computer (`run.host`, #2394), each project's
// as its modules on there bring them (a CI runner), and the one picked in "Run on". The
// pick is the page's, not saved: a host is a project's, and the next opening starts on this
// computer. It holds on a project that has the host, and is none on one that has not.

const EMPTY: readonly RunHostChoice[] = []

/** Each project's hosts as last read, by its id. */
const byProject = new Map<string, readonly RunHostChoice[]>()
/** The projects whose hosts are being read. */
const reading = new Set<string>()
let picked: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function read(projectId: string): void {
  if (reading.has(projectId)) return
  reading.add(projectId)
  void onRunHosts(projectId)
    .then(
      hosts => byProject.set(projectId, hosts),
      () => {},
    )
    .finally(() => {
      reading.delete(projectId)
      notify()
    })
}

/** The hosts beside this computer a run of the project may be picked to run on: none until read, and read again each time a page asks anew. */
export function useRunHosts(projectId: string | null): readonly RunHostChoice[] {
  const hosts = useSyncExternalStore(subscribe, () => (projectId !== null ? byProject.get(projectId) : undefined) ?? EMPTY, () => EMPTY)
  useEffect(() => {
    if (projectId !== null) read(projectId)
  }, [projectId])
  return hosts
}

/** Pick a host as where the next run goes, by its id, or null for none. */
export function selectHost(id: string | null): void {
  if (picked === id) return
  picked = id
  notify()
}

/** The host picked, by its id; null when none is. */
export function useSelectedHost(): string | null {
  return useSyncExternalStore(subscribe, () => picked, () => null)
}

/** The host beside this computer's a run runs on, by its id, as its record's `target` says it: none for this computer's (`local`, or none said). */
export function hostOf(target: string | undefined): string | undefined {
  return target === undefined || target === 'local' ? undefined : target
}

/** The host a run of a project goes to: the one picked, where the project has it. */
export function hostTarget(hosts: readonly RunHostChoice[], selected: string | null): RunHostChoice | undefined {
  return selected === null ? undefined : hosts.find(host => host.id === selected)
}

/** Forget what was read and picked, for a test. */
export function resetRunHostsForTest(): void {
  byProject.clear()
  reading.clear()
  picked = null
  notify()
}
