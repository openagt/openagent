import { afterEach, expect, test, vi } from 'vitest'
import { isUnreachable, openEvents, rpc } from './rpc.js'

// What reaches the daemon for an optional argument left out. JSON writes a trailing `undefined` as
// `null`, and the launcher's check, asked with no coding agent picked, ran `--driver null`.

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The argument list the daemon would parse, for one call. */
async function sent(call: () => Promise<unknown>): Promise<unknown> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ret: null })))
  vi.stubGlobal('fetch', fetchMock)
  await call()
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
  return JSON.parse(init.body as string)
}

const check = rpc<(projectId: string, driver?: string) => Promise<null>>('onStartCheck')

test('a trailing argument left out is not sent', async () => {
  expect(await sent(() => check('p1', undefined))).toEqual(['p1'])
})

test('a trailing argument given is sent', async () => {
  expect(await sent(() => check('p1', 'codex'))).toEqual(['p1', 'codex'])
})

test('the lines a stream brings before anyone listens are handed over, in order, once someone does', async () => {
  // A run on another computer: the server has its first lines already, and sends them at once.
  const frames = ['{"kind":"driver","event":{"type":"start","prompt":"hi"}}', '{"kind":"session","sessionId":"s"}']
  const body = new ReadableStream<Uint8Array>({
    start: controller => {
      for (const data of frames) controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))
  const channel = await openEvents('p1', 'a1')
  await new Promise(resolve => setTimeout(resolve, 20))
  const got: unknown[] = []
  channel.listen(event => got.push(event))
  expect(got).toEqual(frames.map(data => JSON.parse(data)))
  channel.close()
})

test("a request that never reached OpenAgent (it restarts, say) is told apart from a refusal; one the caller gave up on stays the caller's", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
  const failed = await check('p1').catch((err: unknown) => err)
  expect(isUnreachable(failed)).toBe(true)
  expect((failed as Error).message).toBe('OpenAgent did not answer')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'no such project' }), { status: 404 })))
  expect(isUnreachable(await check('p1').catch((err: unknown) => err))).toBe(false)
  const ask = new AbortController()
  ask.abort()
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))))
  const given = await rpc<() => Promise<null>>('onProjects', { signal: ask.signal })().catch((err: unknown) => err)
  expect(isUnreachable(given)).toBe(false)
})
