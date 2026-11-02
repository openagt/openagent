import { useState } from 'react'

// The Context set (#492/#504): the file/repo paths the user picked to focus a run on,
// with immutable add/toggle so React sees a fresh Set on each change. Owned by the shell so
// the Start form's `#`/whole-repo picker and the right-rail file tree share one source of
// truth, and a session's box sends it with the next message too; `reset()` clears it when the
// selected project or session changes (its paths were picked there).
export interface ContextSet {
  context: Set<string>
  add: (path: string) => void
  remove: (path: string) => void
  toggle: (path: string) => void
  reset: () => void
}

export function useContextSet(): ContextSet {
  const [context, setContext] = useState<Set<string>>(new Set())
  const add = (path: string) => setContext(prev => (prev.has(path) ? prev : new Set(prev).add(path)))
  // For a deleted `@`/`#` chip (#948): the editor and the Context set must not diverge.
  const remove = (path: string) =>
    setContext(prev => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  const toggle = (path: string) =>
    setContext(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  const reset = () => setContext(new Set())
  return { context, add, remove, toggle, reset }
}

/**
 * The prompt a run starts with, the Context said at its end as one `Context: <paths>` line (#439):
 * repo paths absolute, file paths relative to the project. At the end, not the head, because a
 * command's prompt must begin with `/<command>`. No Context, the prompt unchanged.
 */
export function promptWithContext(prompt: string, context: Iterable<string>): string {
  const paths = [...context]
  return paths.length ? `${prompt.trimEnd()}\n\nContext: ${paths.join(', ')}` : prompt
}
