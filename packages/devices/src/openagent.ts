/**
 * Ask OpenAgent at `origin` on this computer to run `fn` with `args`, as its own page asks it: from
 * its own address. Answers what it returned; throws when it does not answer, or answers no.
 */
export async function callOpenAgent(origin: string, fn: string, args: unknown[], timeoutMs: number): Promise<unknown> {
  const res = await fetch(`${origin}/_rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`OpenAgent answered ${res.status} to ${fn}`)
  return ((await res.json()) as { ret?: unknown }).ret
}
