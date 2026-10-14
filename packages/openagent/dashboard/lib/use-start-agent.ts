import { useEffect, useRef, useState } from 'react'
import type { Preferences, PublishPick } from '../../src/index.js'
import { sendStart } from '../rpc/control.js'
import { onProjectOnMachine, sendProjectToMachine } from '../rpc/machines.js'
import { useAction } from './use-action.js'

type StartArgs = Parameters<typeof sendStart>

/**
 * The person's picks a start carries to the project's start hook; an unset one is left to the
 * hook's own default. The publish pick is carried as saved, and not at all when none was made: the
 * daemon that starts the run decides the pick in force.
 */
export function startPicks(preferences: Preferences): { driver?: string; model?: string; effort?: string; publish?: PublishPick } {
  return {
    ...(preferences.driver ? { driver: preferences.driver } : {}),
    ...(preferences.model ? { model: preferences.model } : {}),
    ...(preferences.effort ? { effort: preferences.effort } : {}),
    ...(preferences.publish ? { publish: preferences.publish } : {}),
  }
}

/** The command the launcher's "Post-merge cleanup" box follows a run with, offered only where the project has it. */
export const POST_MERGE_CLEANUP = 'post-merge-cleanup'

/** Whether the project offers the post-merge cleanup: it has the command. */
export function offersPostMergeCleanup(commands: readonly { name: string }[]): boolean {
  return commands.some(command => command.name === POST_MERGE_CLEANUP)
}

/**
 * The follow-up a launcher start carries: the cleanup command, when the box is ticked and the
 * project has the command. The start hook gets it in `THEN`; the run's tool gives it the run's id.
 */
export function cleanupPick(preferences: Preferences, commands: readonly { name: string }[]): { then?: string } {
  return preferences.postMergeCleanup && offersPostMergeCleanup(commands) ? { then: `/${POST_MERGE_CLEANUP}` } : {}
}

// Starting a run, for every surface that does (the launcher, the tickets' and the queue's
// buttons): the project's start hook answers the new run's id, or says in words why there is
// none, and neither surface hand-rolls the busy/error/finally scaffold useAction owns.
//
// A run sent to a machine that does not have the project yet: the machine clones it, once, and
// the run starts when it is there. `cloning` is true for as long as that takes, so the surface
// says what it is waiting for. The wait is for the page it began on: `scope` names what that page
// is about (the launcher's project), and a person who leaves the page, or goes to another
// project's launcher, started nothing and is told nothing. The machine goes on cloning, and their
// next send finds the project there.
export function useStartAgent(scope?: string): {
  busy: boolean
  /** The machine the run was sent to is cloning the project, and the start waits for it. */
  cloning: boolean
  error: string | null
  reset: () => void
  /** Start the run; resolves with its id, or `undefined` (error state set, or the page was left). */
  start: (projectId: string, text: string, options?: StartArgs[2], fallback?: string) => Promise<{ agentId: string } | undefined>
} {
  const { busy, error, reset, run } = useAction()
  const [cloningFor, setCloningFor] = useState<{ scope: string | undefined } | null>(null)
  const shown = useRef(true)
  const scopeNow = useRef(scope)
  scopeNow.current = scope
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])
  const start = async (projectId: string, text: string, options: StartArgs[2] = {}, fallback = 'Failed to start the agent.') => {
    const began = scope
    const wanted = (): boolean => shown.current && scopeNow.current === began
    const outcome = await run(async () => {
      const refused = await sendStart(projectId, text, options)
      if (refused.ok || !refused.notThere || options.machine === undefined) return refused
      setCloningFor({ scope: began })
      try {
        const brought = await projectOnTheMachine(projectId, options.machine, wanted)
        if (brought === LEFT || !wanted()) return LEFT
        if (!brought.ok) return brought
      } finally {
        setCloningFor(null)
      }
      return sendStart(projectId, text, options)
    }, fallback)
    return outcome.ok ? (outcome.value ?? undefined) : undefined
  }
  return { busy, cloning: cloningFor !== null && cloningFor.scope === scope, error, reset, start }
}

/** What a wait that was left ends as: no run and no error, since the page it was for is gone. */
const LEFT = null

/** How often a machine at work on a clone is asked whether the project is there. */
export const CLONE_ASKED_EVERY_MS = 2_000
/** How long a clone is waited for: a little longer than a machine lets one take. */
const CLONE_WAITED_MS = 16 * 60_000

/** Have the machine clone the project, and wait until it is there: `wanted` says whether anyone still waits. */
async function projectOnTheMachine(projectId: string, machineId: string, wanted: () => boolean): Promise<{ ok: true } | { ok: false; error: string } | typeof LEFT> {
  const until = Date.now() + CLONE_WAITED_MS
  let said = await sendProjectToMachine(projectId, machineId)
  while (said.ok && !said.there) {
    if (Date.now() > until) return { ok: false, error: 'The machine is still cloning the project. Send again in a few minutes.' }
    await new Promise(resolve => setTimeout(resolve, CLONE_ASKED_EVERY_MS))
    if (!wanted()) return LEFT
    said = await onProjectOnMachine(projectId, machineId)
  }
  return said.ok ? { ok: true } : said
}
