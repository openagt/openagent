import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ClaudeCodeDriver } from './claude-code.js'
import { appendInbox, type DriverEvent } from '@openagt/agent-driver'

// How Claude Code takes a message mid-turn (a stream-json user line it queues and repeats under
// `--replay-user-messages` once it read it) and the person's Stop (the `interrupt` request) is no
// documented interface. This runs the `claude` on this machine against a stand-in for Anthropic's
// API whose model runs one shell command, so a CLI that changes either fails here, and costs
// nothing. Skipped where no `claude` is installed.

const installed = spawnSync('claude', ['--version'], { encoding: 'utf8' })
const skip = installed.status === 0 ? false : 'no `claude` on PATH: the wire test of steering did not run'

/**
 * Anthropic's Messages API, as far as `claude` needs it: a call with no tool result in it yet is
 * answered with a Bash call of `command`; any other with "Done.". Every call's messages are kept.
 */
function standIn(command: string, asked: unknown[][]): Promise<Server> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += String(chunk)))
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(req.url?.includes('count_tokens') ? 200 : 404, { 'content-type': 'application/json' })
        res.end(req.url?.includes('count_tokens') ? '{"input_tokens":10}' : '{}')
        return
      }
      const call = JSON.parse(body || '{}') as { model?: string; messages?: unknown[] }
      const messages = call.messages ?? []
      asked.push(messages)
      const run = !JSON.stringify(messages).includes('tool_result')
      const sse = (event: string, data: object): void => void res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      sse('message_start', { message: { id: `msg_${asked.length}`, type: 'message', role: 'assistant', model: call.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } })
      if (run) {
        sse('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${asked.length}`, name: 'Bash', input: {} } })
        sse('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command, description: 'Wait' }) } })
      } else {
        sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Done.' } })
      }
      sse('content_block_stop', { index: 0 })
      sse('message_delta', { delta: { stop_reason: run ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } })
      sse('message_stop', {})
      res.end()
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** `work`, or a failure that says what most likely changed when `claude` never got that far. */
function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`claude did not ${what} within 45s: its stream-json input may have changed`)), 45_000)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** A session of the installed claude against the stand-in, and its clean-up. */
async function wired(command: string) {
  const asked: unknown[][] = []
  const server = await standIn(command, asked)
  const home = mkdtempSync(join(tmpdir(), 'claude-steer-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'claude-steer-cwd-'))
  const kill = new AbortController()
  const stop = new AbortController()
  const env = {
    PATH: process.env['PATH'],
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ANTHROPIC_API_KEY: 'sk-ant-wire-test',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    // A throwaway home against a stand-in API is a sandbox, and says so: run as root, as in a
    // container, `claude` refuses --dangerously-skip-permissions anywhere else.
    IS_SANDBOX: '1',
  }
  const events: DriverEvent[] = []
  let onAction: () => void = () => {}
  const acted = new Promise<void>(resolve => (onAction = resolve))
  const session = await new ClaudeCodeDriver({ env, permissionMode: 'bypassPermissions' }).start({
    cwd,
    model: 'claude-sonnet-5-5',
    signal: kill.signal,
    stop: stop.signal,
    onEvent: e => {
      events.push(e)
      if (e.type === 'action') onAction()
    },
  })
  return {
    asked,
    events,
    session,
    stop,
    acted,
    inbox: join(cwd, 'inbox.jsonl'),
    done: () => {
      kill.abort()
      server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    },
  }
}

test('the installed claude reads a message sent mid-turn at its next step, and says so', { skip, timeout: 120_000 }, async () => {
  const wire = await wired('sleep 3')
  try {
    const turn = wire.session.prompt('Go.', { inbox: wire.inbox })
    await within(wire.acted, 'run the command')
    await appendInbox(wire.inbox, { kind: 'message', text: 'Also the README.', id: 'm1' })
    const done = await within(turn, 'end the turn')
    assert.equal(done.text, 'Done.')
    assert.equal(done.held, undefined, 'nothing waits for after the turn')
    assert.ok(wire.events.some(e => e.type === 'steered' && e.id === 'm1' && e.text === 'Also the README.'), JSON.stringify(wire.events.map(e => e.type)))
    // The model's call after the command has the message in it: read in the same turn.
    assert.equal(wire.asked.length, 2)
    assert.ok(JSON.stringify(wire.asked[1]).includes('Also the README.'), JSON.stringify(wire.asked[1]))
  } finally {
    wire.done()
  }
})

test('the installed claude stopped mid-command ends its turn at once, stopped and not failed', { skip, timeout: 120_000 }, async () => {
  const wire = await wired('sleep 30')
  try {
    const turn = wire.session.prompt('Go.')
    await within(wire.acted, 'run the command')
    const pressed = Date.now()
    wire.stop.abort()
    const done = await within(turn, 'end the stopped turn')
    assert.equal(done.stopped, true)
    assert.ok(Date.now() - pressed < 8_000, `stopped in ${Date.now() - pressed} ms, not killed after the grace`)
    assert.ok(!wire.events.some(e => e.type === 'error'), JSON.stringify(wire.events.filter(e => e.type === 'error')))
  } finally {
    wire.done()
  }
})
