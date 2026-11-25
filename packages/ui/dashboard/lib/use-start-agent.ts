import type { Preferences, PublishPick } from '../../src/index.js'
import { sendStart } from '../rpc/control.js'
import { useAction } from './use-action.js'

type StartArgs = Parameters<typeof sendStart>

/**
 * The person's picks a start carries to the run: the publish pick as saved, and not at all when
 * none was made, so the daemon that starts the run decides the pick in force.
 */
export function startPicks(preferences: Preferences): { publish?: PublishPick } {
  return preferences.publish ? { publish: preferences.publish } : {}
}

// Starting a run, for every surface that does (the launcher, the onboarding checklist): the
// computer's run host answers the new run's id, or says in words why there is none, and neither
// surface hand-rolls the busy/error/finally scaffold useAction owns.
export function useStartAgent(): {
  busy: boolean
  error: string | null
  reset: () => void
  /** Start the run; resolves with its id, or `undefined` (error state set). */
  start: (projectId: string, text: string, options?: StartArgs[2], fallback?: string) => Promise<{ agentId: string } | undefined>
} {
  const { busy, error, reset, run } = useAction()
  const start = async (projectId: string, text: string, options: StartArgs[2] = {}, fallback = 'Failed to start the agent.') => {
    const outcome = await run(() => sendStart(projectId, text, options), fallback)
    return outcome.ok ? outcome.value : undefined
  }
  return { busy, error, reset, start }
}
