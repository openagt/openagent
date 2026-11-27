import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { SignInCode, SignInWait, TeamState } from '../../src/team/team-gate.js'

export type { SignInCode, SignInWait, TeamState } from '../../src/team/team-gate.js'
export type { TeamPerson } from '../../src/team/team-file.js'

// Team mode, as the page sees it (src/team/team-gate.ts): read once before the dashboard is drawn
// (main.tsx), so a browser not signed in gets the sign-in and nothing else, and read again where
// the team is changed (Settings › Team).

const TEAM_PREFIX = '/_team'

/** What `/_team/me` says; off when it cannot be read (an older OpenAgent, a network down: the dashboard says that itself). */
export async function readTeamState(): Promise<TeamState> {
  try {
    const res = await fetch(`${TEAM_PREFIX}/me`, { cache: 'no-store' })
    if (!res.ok) return { on: false }
    return (await res.json()) as TeamState
  } catch {
    return { on: false }
  }
}

/** A change of the team's, or a step of signing in: what the server answers, or `{ error }`. */
export async function teamCall<T>(path: string, body: Record<string, unknown> = {}): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${TEAM_PREFIX}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const answer = (await res.json().catch(() => ({ error: `OpenAgent answered ${res.status}` }))) as T | { error: string }
    return answer
  } catch {
    return { error: 'OpenAgent did not answer.' }
  }
}

export const startSignIn = (turnOn: boolean) => teamCall<SignInCode>('/sign-in', { turnOn })
export const waitSignIn = (id: string) => teamCall<SignInWait>('/sign-in/wait', { id })

/** Sign this browser out, and show the sign-in. */
export async function signOut(): Promise<void> {
  await teamCall('/sign-out')
  location.reload()
}

/** The state read before the page was drawn, and a way to read it again. */
export const TeamContext = createContext<{ team: TeamState; reload: () => Promise<void> }>({ team: { on: false }, reload: async () => {} })

export function useTeam() {
  return useContext(TeamContext)
}

/** The value {@link TeamContext} holds: `first`, then whatever a reload read. */
export function useTeamState(first: TeamState) {
  const [team, setTeam] = useState(first)
  const reload = useCallback(async () => setTeam(await readTeamState()), [])
  return { team, reload }
}

/**
 * A call refused for want of a sign-in (401): this browser was signed out (removed from the team,
 * Team mode turned on elsewhere). The page is drawn again from the start, which shows the sign-in.
 * Only a page drawn as the dashboard does it: the sign-in's own page asks nothing it could be refused.
 */
let drawnSignedIn = false
export function setDrawnSignedIn(value: boolean): void {
  drawnSignedIn = value
}
export function signedOutByServer(): void {
  if (!drawnSignedIn) return
  drawnSignedIn = false
  location.reload()
}

/** Follow a code to its end: GitHub's answer, asked at the interval it set, until it ends or `stop`. */
export function useSignIn(turnOn: boolean, onDone: () => void) {
  const [code, setCode] = useState<SignInCode | undefined>()
  const [asking, setAsking] = useState(false)
  const [end, setEnd] = useState<{ kind: 'error'; words: string } | { kind: 'not-member'; login: string; owner: string } | undefined>()
  // The page draws again while it waits (its reads go on): the asking follows the code alone, and a
  // new `onDone` each drawing must not start it again, or the answer GitHub gave the first asking is lost.
  const done = useRef(onDone)
  done.current = onDone
  const start = useCallback(async () => {
    setAsking(true)
    setEnd(undefined)
    setCode(undefined)
    const answer = await startSignIn(turnOn)
    setAsking(false)
    if ('error' in answer) setEnd({ kind: 'error', words: answer.error })
    else setCode(answer)
  }, [turnOn])
  useEffect(() => {
    if (!code) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async (interval: number) => {
      timer = setTimeout(async () => {
        const answer = await waitSignIn(code.id)
        if (stopped) return
        if ('error' in answer) return setEnd({ kind: 'error', words: answer.error })
        if (answer.state === 'pending') return void ask(answer.interval)
        setCode(undefined)
        if (answer.state === 'done') return done.current()
        if (answer.state === 'not-member') return setEnd({ kind: 'not-member', login: answer.login, owner: answer.owner })
        setEnd({ kind: 'error', words: answer.reason })
      }, interval * 1000)
    }
    void ask(code.interval)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [code])
  const cancel = useCallback(() => {
    setCode(undefined)
    setEnd(undefined)
  }, [])
  return { code, asking, end, start, cancel }
}
