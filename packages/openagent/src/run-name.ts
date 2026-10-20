import type { AgentMeta } from './store/agent-store.js'

/**
 * What every list calls a run, one rule for all of them (the sidebar, the Human Queue, the
 * launcher's "Waiting on you"), so the same run never goes by two names: its short name, the two to
 * five words a small model gave it, else what the person asked, else the branch it worked on.
 * `undefined` when the run has none of these, and the list says what it has instead.
 */
export function runName(agent: Pick<AgentMeta, 'title' | 'intent' | 'branch'>): string | undefined {
  return agent.title?.trim() || agent.intent?.trim() || agent.branch?.trim() || undefined
}
