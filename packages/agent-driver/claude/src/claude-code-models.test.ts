import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { contextWindowOf, parseInitializeLine, readClaudeModels } from './claude-code-models.js'
import { ClaudeCodeDriver } from './claude-code.js'
import type { SpawnLike, SpawnedProcess } from '@openagt/agent-driver'

/** The CLI's answer to `initialize`, cut to the fields read and one field ignored, as a real one reads. */
const ANSWER = JSON.stringify({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: 'models',
    response: {
      commands: [],
      models: [
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Most capable for ambitious work', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
        { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1', description: 'For your toughest challenges' },
        { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers' },
      ],
    },
  },
})

test('parseInitializeLine reads the models in the CLI\'s order, leaving out "default", each alias with the full id it runs, with what it may think and how much it holds', () => {
  assert.deepEqual(parseInitializeLine(ANSWER), {
    models: [
      // The CLI lists the levels a model may think at; how much conversation it holds it does not
      // say, so that comes from what this package knows of the family (`contextWindowOf`).
      { id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5', efforts: ['low', 'medium', 'high'], contextWindow: 200_000 },
      { id: 'claude-fable-5-1', name: 'Fable 5.1', contextWindow: 200_000 },
      { id: 'haiku', name: 'Haiku 4.5', resolvedId: 'claude-haiku-4-5-20251001', contextWindow: 200_000 },
    ],
  })
  assert.equal(contextWindowOf('gpt-5.6-terra'), undefined, 'a model this does not know says nothing')
})

test('parseInitializeLine skips every other line', () => {
  assert.equal(parseInitializeLine('{"type":"system","subtype":"init"}'), undefined)
  assert.equal(parseInitializeLine('not json'), undefined)
  assert.equal(parseInitializeLine(JSON.stringify({ type: 'control_response', response: { request_id: 'other', subtype: 'success' } })), undefined)
})

test('parseInitializeLine says the CLI\'s own error', () => {
  const line = JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'models', error: 'not logged in' } })
  assert.deepEqual(parseInitializeLine(line), { error: 'Claude Code could not list its models: not logged in' })
})

/** A CLI that prints `lines` once it is sent its request, and records what it was started with and sent. */
interface Seen {
  args?: readonly string[]
  sent: string[]
  killed: boolean
}

function fakeCli(lines: string[], seen: Seen): SpawnLike {
  return (_command, args) => {
    seen.args = args
    const out = new Readable({ read: () => undefined })
    const proc: SpawnedProcess = {
      stdout: out,
      stderr: Readable.from([]),
      stdin: new Writable({
        write: (chunk, _e, cb) => {
          seen.sent.push(String(chunk))
          for (const line of lines) out.push(`${line}\n`)
          cb()
        },
      }),
      on: () => proc,
      kill: () => {
        seen.killed = true
        out.push(null)
      },
    }
    return proc
  }
}

test('readClaudeModels sends only the initialize request, answers the list, and stops the CLI', async () => {
  const seen: Seen = { sent: [], killed: false }
  const models = await readClaudeModels({ spawn: fakeCli(['{"type":"system"}', ANSWER], seen) })
  assert.equal(models.length, 3)
  assert.deepEqual(seen.sent.map(line => JSON.parse(line).request.subtype), ['initialize'])
  assert.ok(seen.args?.includes('--input-format'))
  assert.equal(seen.killed, true)
})

test('readClaudeModels rejects with the reason when the CLI never answers', async () => {
  const seen: Seen = { sent: [], killed: false }
  await assert.rejects(readClaudeModels({ spawn: fakeCli([], seen), timeoutMs: 20 }), /did not list its models within/)
  assert.equal(seen.killed, true)
})

test('readClaudeModels asks in a fresh folder when told, and removes it once the CLI is gone, not when it answered', async () => {
  let env: NodeJS.ProcessEnv = {}
  let close: (code: number | null) => void = () => undefined
  const spawn: SpawnLike = (_command, _args, opts) => {
    env = opts.env ?? {}
    const out = new Readable({ read: () => undefined })
    const proc: SpawnedProcess = {
      stdout: out,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_chunk, _e, cb) => (out.push(`${ANSWER}\n`), cb()) }),
      on: (event, listener) => {
        if (event === 'close') close = listener as (code: number | null) => void
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  await readClaudeModels({ spawn, env: { CLAUDE_CONFIG_DIR: '/the/persons/own' }, freshFolder: true })
  const folder = env['CLAUDE_CONFIG_DIR']
  assert.ok(folder !== undefined && folder !== '/the/persons/own' && existsSync(folder), 'the CLI asks in a folder of its own, there while it runs')
  close(0)
  assert.equal(existsSync(folder), false, 'removed once the CLI has exited')

  await readClaudeModels({ spawn, env: { CLAUDE_CONFIG_DIR: '/the/persons/own' } })
  assert.equal(env['CLAUDE_CONFIG_DIR'], '/the/persons/own', 'otherwise in the folder it is given')
})

test('ClaudeCodeDriver.listModels starts the CLI with the switches that keep the person\'s settings out', async () => {
  const seen: Seen = { sent: [], killed: false }
  const driver = new ClaudeCodeDriver({ spawn: fakeCli([ANSWER], seen), personal: { memory: true, connectors: true, skills: false } })
  await driver.listModels()
  assert.ok(seen.args?.join(' ').includes('--setting-sources project,local'))
})
