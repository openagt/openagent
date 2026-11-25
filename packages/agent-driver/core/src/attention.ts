import { PICKED_AGENT, type AttentionArgs, type AttentionItem, type Settings } from '@openagt/hooks'
import { agentStates, type AgentState } from './setup.js'
import { CONNECT_ITEM, agentItem, loggedOut, notInstalled } from './attention-items.js'

// What the coding agents need of the person (`app.attention`, #2394): on this computer, a coding
// agent to run sessions on, as long as none can run; and above the box that would start a run,
// what stops the agent its picks would run on, with the press that fixes it. Each is fixed by one
// of agent-driver's own actions (`attention.fix`): `connect` opens the window an account is added
// in, `install` installs the agent's program with the command its package declared.

/** What is in the way of the agent, in words. */
export function agentWords(state: AgentState): string {
  return notInstalled(state) ? `${state.label} is not installed.` : loggedOut(state) ? `${state.label} is not logged in.` : (state.problem ?? `${state.label} cannot start.`)
}

/** The names of the agents, as a sentence lists them: "Claude Code or Codex". */
function either(states: readonly AgentState[]): string {
  const names = states.map(state => state.label)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? 'a coding agent')
}

/** The item of the agent a run would be on, where it cannot run: what is in the way, and the press that fixes it. */
function runItem(state: AgentState): AttentionItem {
  const id = agentItem(state.agent)
  if (state.fixing) return { kind: 'setup', scope: 'run', id, words: `Installing ${state.label}…`, ...(state.fix ? { detail: `\`${state.fix.command}\`` } : {}) }
  const fix = notInstalled(state) && state.fix?.kind === 'install' ? { label: `Install ${state.label}`, action: 'install' } : state.list !== undefined && !notInstalled(state) ? { label: 'Add account', action: 'connect' } : undefined
  const words = agentWords(state)
  // The command an install runs is said under its words, so the person sees what is done on their computer; why the last one failed, after it.
  const detail = [fix?.action === 'install' ? `\`${state.fix!.command}\`` : state.problem !== words ? state.problem : undefined, state.failed].filter(Boolean).join(' ')
  return { kind: 'setup', scope: 'run', id, words, ...(detail ? { detail } : {}), ...(fix ? { fix } : {}) }
}

/**
 * What the coding agents need of the person: with no coding agent that can run here, one to
 * connect (about this computer); with run options asked (the launcher's), what stops the agent they
 * would run on: the one they name, else the one picked for every next run, else the first.
 */
export async function agentAttention(args: AttentionArgs, settings: Pick<Settings, 'get'>, states: () => Promise<AgentState[]> = agentStates): Promise<AttentionItem[]> {
  const all = await states()
  if (all.length === 0) return []
  const items: AttentionItem[] = []
  if (!all.some(state => state.ready)) {
    items.push({
      kind: 'setup',
      scope: 'computer',
      id: CONNECT_ITEM,
      words: 'Connect a coding agent',
      detail: `Sessions run on ${either(all)}, with your own account. One is enough; add the other any time.`,
      fix: { label: 'Connect a coding agent…', action: 'connect' },
    })
  }
  if (args.options !== undefined) {
    const named = args.options['agent-driver']?.driver ?? (await settings.get(PICKED_AGENT).catch(() => ({}) as { driver?: string })).driver
    const state = all.find(one => one.agent === named) ?? all[0]!
    if (!state.ready) items.push(runItem(state))
  }
  return items
}
