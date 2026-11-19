// How hard the model may think, as a person reads the level: the agent's own word, capitalised. One
// is spelled out — `xhigh` is the agent's id for it and "Xhigh" is nobody's word — and any level not
// listed here is shown as the agent writes it, so a new one needs no change to appear.

const SPELLED: Record<string, string> = { xhigh: 'Extra high' }

export function effortLabel(effort: string): string {
  return SPELLED[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}
