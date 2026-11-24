import type { ChoiceBy } from '@openagt/hooks'

/** What a {@link import('./agent.js').RunOpenAgentOptions.requestChoice} handler resolves with. */
export interface ChoicePick {
  /** The picked option id, or (for a {@link ChoiceRequest.multi} select) the selected subset of ids. */
  picked: string | readonly string[]
  /** Who picked it. Default `'user'`. */
  by?: ChoiceBy
}

/** Normalize a {@link ChoicePick} (single id or subset) to a list of picked ids. */
export function pickedIds(picked: string | readonly string[]): string[] {
  return Array.isArray(picked) ? [...picked] : picked ? [picked as string] : []
}
