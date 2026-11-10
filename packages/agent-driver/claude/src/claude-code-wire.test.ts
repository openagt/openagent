import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ClaudeCodeDriver } from './claude-code.js'
import type { DriverEvent } from '@openagt/agent-driver'

// How Claude Code asks its questions over stdin (`--permission-prompt-tool stdio`, the
// `control_request` it writes, the interrupt it is answered with) is no documented interface: it
// was read off @anthropic-ai/claude-agent-sdk 0.3.318. This runs the `claude` on this machine
// against a stand-in for Anthropic's API that makes the model call AskUserQuestion, so a CLI
// that changes any of it fails here, and costs nothing. Skipped where no `claude` is installed.

const installed = spawnSync('claude', ['--version'], { encoding: 'utf8' })
const skip = installed.status === 0 ? false : 'no `claude` on PATH: the wire test of AskUserQuestion did not run'

const input = { questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Blue (Recommended)', description: 'Light blue' }, { label: 'Green', description: 'Light green' }], multiSelect: false }] }

/** One model call, as the stand-in was asked it. */
interface Asked {
  tools: string[]
  messages: unknown[]
}

/**
 * Anthropic's Messages API, as far as `claude` needs it: a call that offers AskUserQuestion, with
 * no tool result in it yet, is answered with a sentence and the call; any other with "Done.".
 */
function standIn(asked: Asked[]): Promise<Server> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += String(chunk)))
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(req.url?.includes('count_tokens') ? 200 : 404, { 'content-type': 'application/json' })
        res.end(req.url?.includes('count_tokens') ? '{"input_tokens":10}' : '{}')
        return
      }
      const call = JSON.parse(body || '{}') as { model?: string; tools?: { name: string }[]; messages?: unknown[] }
      const tools = (call.tools ?? []).map(tool => tool.name)
      const messages = call.messages ?? []
      asked.push({ tools, messages })
      const ask = tools.includes('AskUserQuestion') && !JSON.stringify(messages).includes('AskUserQuestion')
      const sse = (event: string, data: object): void => void res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      sse('message_start', { message: { id: `msg_${asked.length}`, type: 'message', role: 'assistant', model: call.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } })
      sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: ask ? 'One thing first.' : 'Done.' } })
      sse('content_block_stop', { index: 0 })
      if (ask) {
        sse('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_wire', name: 'AskUserQuestion', input: {} } })
        sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
        sse('content_block_stop', { index: 1 })
      }
      sse('message_delta', { delta: { stop_reason: ask ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } })
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
    timer = setTimeout(() => reject(new Error(`claude did not ${what} within 45s: its stdio question protocol may have changed`)), 45_000)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

test('the installed claude asks AskUserQuestion over stdin as the driver reads it, and an answer resumes the stopped turn', { skip, timeout: 120_000 }, async () => {
  const asked: Asked[] = []
  const server = await standIn(asked)
  const home = mkdtempSync(join(tmpdir(), 'claude-wire-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'claude-wire-cwd-'))
  // A claude that never ends its turn is stopped with the test, or it keeps the test process alive.
  const stop = new AbortController()
  try {
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
    const session = await new ClaudeCodeDriver({ env, permissionMode: 'bypassPermissions' }).start({ cwd, model: 'claude-sonnet-5-5', signal: stop.signal, onEvent: e => events.push(e) })
    const turn = await within(session.prompt('Ask me which colour.'), 'end the turn on its question')

    // The flag gives the model the tool, and only that one: plan mode's two stay out.
    assert.ok(asked[0]!.tools.includes('AskUserQuestion'), `AskUserQuestion is offered: ${asked[0]!.tools.join(', ')}`)
    assert.ok(!asked[0]!.tools.includes('EnterPlanMode') && !asked[0]!.tools.includes('ExitPlanMode'))
    // The request was read, its fields mapped, and the turn stopped on it, over and not failed.
    assert.deepEqual(turn.question, { title: 'Which colour?', header: 'Colour', options: [{ id: 'opt:0', label: 'Blue', detail: 'Light blue' }, { id: 'opt:1', label: 'Green', detail: 'Light green' }], recommended: 'opt:0' })
    assert.equal(turn.text, 'One thing first.')
    assert.ok(!events.some(e => e.type === 'error' || e.type === 'notice'), JSON.stringify(events.filter(e => e.type === 'error' || e.type === 'notice')))
    assert.equal(asked.length, 1, 'stopped, the turn made no second model call')

    // The answer resumes the same conversation, which holds the question it stopped on.
    const resumed = await within(session.prompt('You paused to ask: "Which colour?". The user chose: Green. Continue with that decision.', { resume: true }), 'answer the resumed turn')
    assert.equal(resumed.text, 'Done.')
    assert.equal(resumed.question, undefined)
    const history = JSON.stringify(asked.at(-1)!.messages)
    assert.ok(history.includes('toolu_wire') && history.includes('The user chose: Green'), history)
  } finally {
    stop.abort()
    server.close()
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})
