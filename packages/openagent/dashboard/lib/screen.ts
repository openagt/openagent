// A run's live screen, as the dashboard asks OpenAgent for it (`/_screen`, src/dashboard/screen.ts):
// what it shows, as the screen's own stream of bytes, and what the person did on it. OpenAgent
// asks the computer the run is on; a page never calls that computer itself.

function at(call: 'stream' | 'input', projectId: string, agentId: string): string {
  return `/_screen/${call}?project=${encodeURIComponent(projectId)}&run=${encodeURIComponent(agentId)}`
}

/** What the run's live screen shows, until `signal` ends it; nothing when the run has no live screen, or it cannot be reached. */
export async function watchScreen(projectId: string, agentId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | undefined> {
  const answer = await fetch(at('stream', projectId, agentId), { signal }).catch(() => undefined)
  return answer?.ok && answer.body ? answer.body : undefined
}

/** Send the run's live screen what the person did on it; whether the screen took it. */
export function sendToScreen(projectId: string, agentId: string, input: unknown): Promise<boolean> {
  return fetch(at('input', projectId, agentId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then(
    answer => answer.ok,
    () => false,
  )
}
