import { runName as named } from '@openagt/hooks'
import type { AgentMeta } from './store/index.js'

/**
 * What every list calls a run (the sidebar, the Human Queue, the launcher's "Waiting on you"), by
 * the kernel's one rule for it (`runName`), so the same run never goes by two names. `undefined`
 * when the run has none of its names yet, and the list says what it has instead.
 */
export function runName(agent: Pick<AgentMeta, 'title' | 'intent' | 'branch'>): string | undefined {
  return named({ title: agent.title, prompt: agent.intent }, agent.branch)
}
