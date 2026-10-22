import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { oneLine, type SpawnLike } from '@openagt/agent-driver'

// Codex's app server asked something that is not a turn: who is logged in, how full the account
// is, a login. One process per question, in the Codex home it is about: each home is one login.

/** How a Codex app server is reached for a question. */
export interface AskOptions {
  /** The Codex home the question is about. */
  home: string
  /** CLI binary. Default `"codex"`. */
  bin?: string
  env?: NodeJS.ProcessEnv
  spawn?: SpawnLike
}

/** An app server started for questions: requests, the notifications it sends, and its end. */
export interface CodexAsk {
  request(method: string, params: unknown): Promise<Record<string, unknown>>
  /** Called with each notification, by its method. */
  onNotification(listener: (method: string, params: Record<string, unknown>) => void): void
  /** Ends the server. */
  close(): void
  /** Settles when the server is gone, for whatever reason. */
  gone: Promise<void>
}

/** Start a Codex app server in `home`, ready for requests once `initialize` is answered. */
export async function askCodex(opts: AskOptions): Promise<CodexAsk> {
  const bin = opts.bin ?? 'codex'
  const spawn = opts.spawn ?? (nodeSpawn as unknown as SpawnLike)
  const child = spawn(bin, ['app-server'], { cwd: opts.home, env: { ...(opts.env ?? process.env), CODEX_HOME: opts.home } })
  const waiting = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (err: Error) => void }>()
  const listeners: ((method: string, params: Record<string, unknown>) => void)[] = []
  let nextId = 0
  let said = ''
  let goneWith: Error | undefined
  const gone = new Promise<void>(resolve => {
    const end = (err: Error): void => {
      goneWith ??= err
      for (const wait of waiting.values()) wait.reject(goneWith)
      waiting.clear()
      resolve()
    }
    child.on('error', (err: Error) => end(new Error(`\`${bin}\` could not start: ${err.message}`)))
    child.on('close', () => end(new Error(`Codex ended before it answered${said ? `: ${oneLine(said)}` : ''}`)))
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    said = (said + String(chunk)).slice(-2000)
  })
  if (child.stdout)
    createInterface({ input: child.stdout }).on('line', line => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      if (typeof msg !== 'object' || msg === null) return
      const id = msg['id']
      const method = msg['method']
      if (typeof method !== 'string') {
        const wait = typeof id === 'number' ? waiting.get(id) : undefined
        if (!wait) return
        waiting.delete(id as number)
        const error = msg['error'] as { message?: unknown } | undefined
        if (error) wait.reject(new Error(typeof error.message === 'string' ? error.message : 'Codex refused the request'))
        else wait.resolve((msg['result'] ?? {}) as Record<string, unknown>)
        return
      }
      // A request of the server's own: nobody is here to answer it.
      if (id !== undefined) return write({ id, error: { code: -32601, message: 'nothing here answers requests' } })
      const params = msg['params']
      if (typeof params === 'object' && params !== null) for (const listener of listeners) listener(method, params as Record<string, unknown>)
    })
  const write = (msg: unknown): void => {
    child.stdin?.write(`${JSON.stringify(msg)}\n`)
  }
  const ask: CodexAsk = {
    request: (method, params) =>
      goneWith
        ? Promise.reject(goneWith)
        : new Promise((resolve, reject) => {
            const id = ++nextId
            waiting.set(id, { resolve, reject })
            write({ id, method, params })
          }),
    onNotification: listener => void listeners.push(listener),
    close: () => {
      child.stdin?.end()
      child.kill('SIGTERM')
    },
    gone,
  }
  try {
    await ask.request('initialize', { clientInfo: { name: 'openagent', version: '1' } })
  } catch (err) {
    ask.close()
    throw err
  }
  write({ method: 'initialized' })
  return ask
}

/** One question to a Codex home, its server ended after the answer, or after `timeoutMs`. */
export async function askOnce(opts: AskOptions & { timeoutMs?: number }, method: string, params: unknown): Promise<Record<string, unknown>> {
  let timer: NodeJS.Timeout | undefined
  const ask = askCodex(opts)
  try {
    return await Promise.race([
      ask.then(server => server.request(method, params)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Codex did not answer within ${Math.round((opts.timeoutMs ?? ASK_TIMEOUT_MS) / 1000)}s`)), opts.timeoutMs ?? ASK_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
    void ask.then(server => server.close(), () => {})
  }
}

const ASK_TIMEOUT_MS = 20_000
