import { useEffect, useSyncExternalStore } from 'react'
import { computerRpcClient, type ModuleHost } from '@openagt/ui/module'
import type { Kind, Kinds } from '../src/kinds.js'

// The person's kinds of notification, read through the package's server part in no project, as
// one value for the notifier and the Settings entry: a switch saved in one is heard in the other at
// once, and one saved on another of the person's computers within a minute.

const server = (host: ModuleHost) => computerRpcClient<typeof import('../src/server.js')>(host)

let current: Kinds | undefined
const listeners = new Set<() => void>()

function changed(next: Kinds): void {
  current = next
  for (const onChange of listeners) onChange()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => void listeners.delete(onChange)
}

/** The person's kinds, read now and every minute; undefined until the first read answers. */
export function useKinds(host: ModuleHost): Kinds | undefined {
  const kinds = useSyncExternalStore(subscribe, () => current, () => undefined)
  useEffect(() => {
    let live = true
    // A read that fails keeps what was read before: the next one may answer.
    const read = () => void server(host).kinds({}).then(next => live && changed(next), () => {})
    read()
    const timer = setInterval(read, 60_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [host])
  return kinds
}

/** Switch one kind on or off for the person; throws why it could not. */
export async function switchKind(host: ModuleHost, kind: Kind, on: boolean): Promise<void> {
  changed(await server(host).saveKind({ kind, on }))
}

/** Forget what was read: for a test that starts afresh. */
export function forgetKinds(): void {
  current = undefined
}
