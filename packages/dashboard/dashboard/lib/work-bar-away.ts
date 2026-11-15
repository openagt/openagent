import { useState } from 'react'

// A run's work bar put away by its ✕, at what the bar was about then: it stays away for that run in
// this browser, across a reload, until the work moves on or Session actions brings it back.

/** localStorage key prefix of what each run's bar was put away at. */
const HIDDEN_KEY = 'oa.work-bar-hidden:'

/** Whether `run`'s bar is put away while it is about `state`; `hide` puts it away at that state, `show` brings it back. */
export function useWorkBarAway(run: string, state: string): { away: boolean; hide: () => void; show: () => void } {
  // Put away or brought back on this page, which a browser that keeps nothing still honours; else as this browser kept it.
  const [here, setHere] = useState<{ run: string; at: string | null } | null>(null)
  const at = here?.run === run ? here.at : keptHidden(run)
  return {
    away: at === state,
    hide: () => {
      keep(run, state)
      setHere({ run, at: state })
    },
    show: () => {
      keep(run, null)
      setHere({ run, at: null })
    },
  }
}

function keptHidden(run: string): string | null {
  try {
    return globalThis.localStorage?.getItem(HIDDEN_KEY + run) ?? null
  } catch {
    return null
  }
}

function keep(run: string, state: string | null): void {
  try {
    if (state === null) globalThis.localStorage?.removeItem(HIDDEN_KEY + run)
    else globalThis.localStorage?.setItem(HIDDEN_KEY + run, state)
  } catch {
    // Kept for this page's life only.
  }
}
