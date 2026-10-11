import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { activePage, connectCdp, listPages, type CdpSession, type PageTarget } from './cdp.js'
import { launchChrome, type Chrome } from './chrome.js'
import { click, navigate, PageError, press, readPage, run, screenshot, type } from './page.js'
import { inputCalls, stepHistory, type ScreenInput } from './screen.js'
import { FRAME, MAX_TITLE, MAX_URL, PULSE, STATE, streamPart } from './stream.js'

/**
 * The browser's own process: started by the first `open`, it keeps Chrome, the page connection
 * and the screen, and takes the agent's commands over loopback HTTP. Two tokens, and anything
 * that carries neither is refused: the one the state file holds, which the command reads, runs
 * the agent's commands; the one the screen's address holds lets a person watch (`/stream`) and
 * click and type (`/input`), and nothing else, so whoever reads a run's diary never holds what
 * runs a command.
 *
 * The screen is a stream of pictures and of what the address bar says (stream.ts), made only
 * while someone watches: Chrome draws no picture for nobody, and a page that stands still sends
 * none. A watcher too slow for the pictures gets the newest one when it is ready for it, never a
 * queue of old ones.
 *
 * It ends, closing Chrome, on the first of: `browser close`; the run it belongs to ending (an
 * `ended` line reaching the diary after it started); the diary's file going away (the run's
 * checkout reclaimed); no command and no input for `idleMs`; Chrome exiting.
 */

/** What the state file holds, for the command to find this process. */
export interface HostState {
  pid: number
  port: number
  token: string
}

export interface HostOptions {
  chromePath: string
  stateFile: string
  /** The run's diary, from `AGENT_DIARY`; absent outside a run, and then no screen line is written. */
  diary?: string
  idleMs: number
}

/** A command the agent sent, as the CLI forwards it. */
export interface HostCommand {
  name: 'open' | 'read' | 'click' | 'type' | 'press' | 'screenshot' | 'eval' | 'close'
  args: string[]
}

export type HostAnswer = { ok: true; output: string; png?: string } | { ok: false; reason: string }

/** The screen line a diary gets: where the live view is, and what it showed then. Written with `at`, its time, as every diary line is. */
export interface ScreenLine {
  kind: 'screen'
  url: string
  label: string
  ended?: true
}

/** The pictures Chrome is asked for: at most this large, and at most one every `FRAME_GAP_MS`. */
const CAST = { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 }
const FRAME_GAP_MS = 80
/** How many may watch one browser at once: a person and their devices, generously. */
const MAX_VIEWERS = 8
/** How often a stream that says nothing else says it is still there. */
const PULSE_EVERY_S = 20

/** One person watching: the answer their stream is written to, the picture kept for when it can take one, and what it was last told the address bar says. */
interface Viewer {
  res: ServerResponse
  waiting?: Buffer
  said?: string
}

/** How long a command may take before the agent is told the page did not answer. */
export const COMMAND_MS = 30_000

/** `work`, or a refusal once `ms` pass; the work itself goes on. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PageError(`the page did not answer within ${ms / 1000}s: read it again, or close the browser and open it again`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export async function runHost(opts: HostOptions): Promise<void> {
  const token = randomBytes(16).toString('hex')
  const viewToken = randomBytes(16).toString('hex')
  let chrome: Chrome
  try {
    chrome = await launchChrome(opts.chromePath)
  } catch (err) {
    await writeState(opts.stateFile, { error: err instanceof Error ? err.message : String(err) })
    return
  }

  let page: CdpSession | undefined
  let pageId: string | undefined
  let latest: Buffer | undefined
  const viewers = new Set<Viewer>()
  /** The page connection Chrome is drawing pictures on; none while nobody watches. */
  let casting: CdpSession | undefined
  let lastUse = Date.now()
  let screenUrl = ''
  let screenShown = false

  /** Dialogs the page opened since the last command answered, each accepted as it opened. */
  let dialogs: string[] = []
  /** The last attach, so two callers never attach to a new tab at once. */
  let attaching: Promise<CdpSession> | undefined

  /** The page the agent is on, connected, with the screencast running on it. Follows a new tab. */
  const current = (): Promise<CdpSession> => {
    const run = (attaching ?? Promise.resolve(undefined)).catch(() => undefined).then(() => attach())
    attaching = run
    return run
  }
  const attach = async (): Promise<CdpSession> => {
    const target: PageTarget | undefined = activePage(await listPages(chrome.endpoint).catch(() => []))
    if (!target) throw new PageError('the browser has no page open')
    if (page?.open && target.id === pageId) return page
    const next = await connectCdp(target.webSocketDebuggerUrl!)
    next.on('Page.screencastFrame', params => {
      latest = Buffer.from(String(params['data']), 'base64')
      for (const viewer of viewers) show(viewer, latest)
      // Chrome draws the next picture once this one is taken: taken a moment later, so a page
      // that moves all the time costs a bounded number of pictures, and not at all once nobody
      // watches, whatever became of the call that told Chrome to stop.
      setTimeout(() => {
        if (casting === next && viewers.size > 0) void next.send('Page.screencastFrameAck', { sessionId: params['sessionId'] }).catch(() => {})
      }, FRAME_GAP_MS)
    })
    // A dialog blocks the page until answered: every one is accepted at once, and the next
    // answer to the agent names it.
    next.on('Page.javascriptDialogOpening', params => {
      dialogs.push(`${String(params['type'])} ${JSON.stringify(String(params['message'] ?? ''))}`)
      void next.send('Page.handleJavaScriptDialog', { accept: true, ...(params['type'] === 'prompt' ? { promptText: String(params['defaultPrompt'] ?? '') } : {}) }).catch(() => {})
    })
    await next.send('Page.enable')
    const previous = page
    page = next
    pageId = target.id
    previous?.close()
    await cast()
    return next
  }

  /** A picture for one watcher: now when its stream takes it, else kept, the newest only, for when it does. */
  const show = (viewer: Viewer, jpeg: Buffer): void => {
    if (viewer.res.writableNeedDrain) viewer.waiting = jpeg
    else viewer.res.write(streamPart(FRAME, jpeg))
  }

  /** Chrome draws pictures of the page the agent is on while someone watches, and none otherwise. */
  let castTurn: Promise<void> = Promise.resolve()
  const cast = (): Promise<void> =>
    (castTurn = castTurn.then(async () => {
      const wanted = viewers.size > 0 && page?.open ? page : undefined
      if (wanted === casting) return
      const was = casting
      casting = wanted
      // A picture from before the pause is not what the page shows now.
      latest = undefined
      if (was?.open) await was.send('Page.stopScreencast').catch(() => {})
      if (wanted) await wanted.send('Page.startScreencast', CAST).catch(() => {})
    }))

  /**
   * Tell each watcher what the address bar says, when it is not what it was last told; a watcher
   * whose stream is full is told at a later turn. A page that opened in a new tab is followed
   * first, so the address is never one page's over another's picture.
   */
  let pulseIn = PULSE_EVERY_S
  const tell = async (): Promise<void> => {
    if (viewers.size === 0) return
    const target = activePage(await listPages(chrome.endpoint).catch(() => []))
    if (target && target.id !== pageId) await current().catch(() => {})
    const said = JSON.stringify({ url: (target?.url ?? '').slice(0, MAX_URL), title: (target?.title ?? '').slice(0, MAX_TITLE) })
    const pulse = --pulseIn <= 0
    if (pulse) pulseIn = PULSE_EVERY_S
    for (const viewer of viewers) {
      if (viewer.res.writableNeedDrain) continue
      if (viewer.said !== said) {
        viewer.said = said
        viewer.res.write(streamPart(STATE, Buffer.from(said)))
      } else if (pulse) viewer.res.write(streamPart(PULSE))
    }
  }
  try {
    await current()
  } catch (err) {
    await chrome.close()
    await writeState(opts.stateFile, { error: err instanceof Error ? err.message : String(err) })
    return
  }

  const writeScreen = async (line: ScreenLine): Promise<void> => {
    if (!opts.diary) return
    await appendFile(opts.diary, JSON.stringify({ ...line, at: new Date().toISOString() }) + '\n').catch(() => {})
  }

  /** The command before, so the next one starts once it has answered. */
  let queue: Promise<unknown> = Promise.resolve()

  let ending: Promise<void> | undefined
  const end = (): Promise<void> =>
    (ending ??= (async () => {
      clearInterval(timer)
      clearInterval(telling)
      for (const viewer of viewers) viewer.res.end()
      page?.close()
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
      if (screenShown && !runEnded) await writeScreen({ kind: 'screen', url: screenUrl, label: 'browser · closed', ended: true })
      await chrome.close()
      // A browser started after this one closed writes the same file: only this one's goes.
      const state = await readFile(opts.stateFile, 'utf8').catch(() => '')
      if (state.includes(token)) await rm(opts.stateFile, { force: true })
    })())

  const command = async (cmd: HostCommand): Promise<HostAnswer> => {
    const [first = '', second = ''] = cmd.args
    const ref = (): number => {
      const n = Number(first)
      if (!Number.isInteger(n) || n < 1) throw new PageError(`${first || '(nothing)'} is not an element number: use the number in brackets from the last read`)
      return n
    }
    const p = await current()
    switch (cmd.name) {
      case 'open': {
        await navigate(p, first)
        const output = await readPage(p)
        // The chat gets a screen here, where the agent used the browser.
        const url = /^URL: (.*)$/m.exec(output)?.[1] ?? first
        await writeScreen({ kind: 'screen', url: screenUrl, label: `browser · ${url}` })
        screenShown = true
        return { ok: true, output }
      }
      case 'read':
        return { ok: true, output: await readPage(p) }
      case 'click':
        await click(p, ref())
        return { ok: true, output: await readPage(await current()) }
      case 'type':
        await type(p, ref(), second)
        return { ok: true, output: await readPage(await current()) }
      case 'press':
        await press(p, first)
        return { ok: true, output: await readPage(await current()) }
      case 'screenshot':
        return { ok: true, output: '', png: (await screenshot(p)).toString('base64') }
      case 'eval':
        return { ok: true, output: await run(p, first) }
      case 'close':
        setImmediate(() => void end())
        return { ok: true, output: 'The browser is closed.' }
    }
  }

  const server = createServer((req, res) => {
    void serve(req, res).catch(err => {
      if (!res.headersSent) res.writeHead(500).end(err instanceof Error ? err.message : String(err))
    })
  })

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const said = url.searchParams.get('t') ?? req.headers['x-browser-token']
    // The screen's own two paths take the screen's token; every other path is the command's.
    const ofScreen = url.pathname === '/stream' || url.pathname === '/input'
    if (!sameToken(said, ofScreen ? viewToken : token)) return void res.writeHead(403).end()
    if (req.method === 'GET' && url.pathname === '/alive') return void res.writeHead(204).end()
    if (req.method === 'GET' && url.pathname === '/stream') {
      if (viewers.size >= MAX_VIEWERS) return void res.writeHead(503).end()
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', connection: 'close' })
      res.flushHeaders()
      const viewer: Viewer = { res }
      viewers.add(viewer)
      res.on('drain', () => {
        const kept = viewer.waiting
        delete viewer.waiting
        if (kept) show(viewer, kept)
      })
      req.on('close', () => {
        viewers.delete(viewer)
        void cast()
      })
      // Someone who joins a screen others watch sees what they see; the first one waits for
      // the picture Chrome draws as it starts.
      if (latest) show(viewer, latest)
      void cast()
      void tell().catch(() => {})
      return
    }
    if (req.method !== 'POST') return void res.writeHead(404).end()
    const body = await readBody(req)
    lastUse = Date.now()
    if (url.pathname === '/input') {
      const input = body as ScreenInput
      const p = await current()
      if (input?.type === 'back' || input?.type === 'forward') {
        await stepHistory(p, input.type === 'back' ? -1 : 1)
        return void res.writeHead(204).end()
      }
      const calls = inputCalls(input)
      for (const call of calls) await p.send(call.method, call.params).catch(() => {})
      return void res.writeHead(calls.length ? 204 : 400).end()
    }
    if (url.pathname === '/command') {
      let answer: HostAnswer
      try {
        // One command at a time: two at once on one page would cancel each other's loads. The
        // next waits for this one's answer, which comes within COMMAND_MS whatever the page does.
        const turn = queue.then(() => withTimeout(command(body as HostCommand), COMMAND_MS))
        queue = turn.catch(() => {})
        answer = await turn
      } catch (err) {
        answer = { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
      if (dialogs.length) {
        const named = dialogs.map(d => `Dialog, accepted: ${d}`)
        answer = answer.ok ? { ...answer, output: [...named, '', answer.output].join('\n') } : { ok: false, reason: [...named, answer.reason].join('\n') }
      }
      dialogs = []
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer))
    }
    res.writeHead(404).end()
  }

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  screenUrl = `http://127.0.0.1:${port}/?t=${viewToken}`

  const telling = setInterval(() => void tell().catch(() => {}), 1000)

  // Where the run's diary stood when this started: an `ended` line after it is this run ending.
  let diaryOffset = opts.diary ? (await stat(opts.diary).catch(() => undefined))?.size ?? 0 : 0
  let runEnded = false
  const timer = setInterval(() => {
    void (async () => {
      if (Date.now() - lastUse > opts.idleMs) return end()
      if (opts.diary) {
        const read = await readFrom(opts.diary, diaryOffset)
        if (read === undefined) {
          runEnded = true
          return end()
        }
        // A diary written back shorter (a run resumed from its record) is followed from its end.
        if (read.size < diaryOffset) diaryOffset = read.size
        const fresh = read.bytes
        // Only whole lines are read: a line still being written is read again, complete, next time.
        const whole = fresh.lastIndexOf(0x0a) + 1
        diaryOffset += whole
        // A run that stops on a question ends `waiting` and keeps its browser for the answer.
        if (diaryLines(fresh.subarray(0, whole)).some(line => line['kind'] === 'ended' && line['status'] !== 'waiting')) {
          runEnded = true
          return end()
        }
      }
    })()
  }, 2000)

  chrome.process.once('exit', () => void end())
  process.once('SIGTERM', () => void end())
  process.once('SIGINT', () => void end())

  await writeState(opts.stateFile, { pid: process.pid, port, token } satisfies HostState)
  await new Promise<void>(resolve => server.once('close', () => resolve()))
  await ending
}

/** Whether a request carries the token asked of it, compared in a time that tells nothing of where they differ. */
function sameToken(said: string | string[] | null | undefined, token: string): boolean {
  if (typeof said !== 'string') return false
  const a = Buffer.from(said)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The file's bytes from `offset` on and its size, or `undefined` when the file is gone. */
async function readFrom(path: string, offset: number): Promise<{ bytes: Buffer; size: number } | undefined> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return undefined
  try {
    const { size } = await handle.stat()
    if (size <= offset) return { bytes: Buffer.alloc(0), size }
    const buffer = Buffer.alloc(size - offset)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    return { bytes: buffer.subarray(0, bytesRead), size }
  } finally {
    await handle.close()
  }
}

/** The diary lines in `bytes`, each parsed; a line that is not JSON is skipped. */
function diaryLines(bytes: Buffer): Record<string, unknown>[] {
  return bytes
    .toString('utf8')
    .split('\n')
    .flatMap(line => {
      try {
        return line.trim() ? [JSON.parse(line) as Record<string, unknown>] : []
      } catch {
        return []
      }
    })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000) throw new Error('request too large')
  }
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

async function writeState(file: string, state: HostState | { error: string }): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, JSON.stringify(state), { mode: 0o600 })
}
