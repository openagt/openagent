import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from './cli.js'
import { MAX_CONTENT, webhookFile } from './webhook.js'

/** A webhook on loopback that keeps what it was sent and answers `status`. */
async function hook(status = 204): Promise<{ url: string; bodies: unknown[]; server: Server }> {
  const bodies: unknown[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      bodies.push(JSON.parse(raw))
      res.writeHead(status).end(status === 204 ? undefined : 'nope')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/1/x`, bodies, server }
}

async function cli(env: NodeJS.ProcessEnv, ...argv: string[]): Promise<{ code: number; json: Record<string, unknown>; err: string }> {
  let out = ''
  let err = ''
  const code = await runCli(argv, { env, stdout: line => (out += line), stderr: line => (err += line) })
  return { code, json: out ? JSON.parse(out) : {}, err }
}

async function machine(): Promise<NodeJS.ProcessEnv> {
  return { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'skill-discord-')) }
}

test('setup saves the webhook for this user only, and send posts to it with no pings', async () => {
  const env = await machine()
  const { url, bodies, server } = await hook()
  try {
    const saved = await cli(env, 'setup', url)
    assert.equal(saved.code, 0)
    assert.equal((await readFile(webhookFile(env), 'utf8')).trim(), url)
    assert.equal((await stat(webhookFile(env))).mode & 0o777, 0o600)
    const sent = await cli(env, 'send', 'gemstack: a run is waiting for you')
    assert.deepEqual([sent.code, sent.json], [0, { ok: true, source: 'saved' }])
    assert.deepEqual(bodies, [{ content: 'gemstack: a run is waiting for you', allowed_mentions: { parse: [] } }])
    assert.deepEqual((await cli(env, 'status')).json, { ok: true, webhook: true, source: 'saved' })
  } finally {
    server.close()
  }
})

test('DISCORD_WEBHOOK wins over the saved webhook', async () => {
  const env = await machine()
  const saved = await hook()
  const fromEnv = await hook()
  try {
    await cli(env, 'setup', saved.url)
    const sent = await cli({ ...env, DISCORD_WEBHOOK: fromEnv.url }, 'send', 'hi')
    assert.equal(sent.json['source'], 'env')
    assert.equal(saved.bodies.length, 0)
    assert.equal(fromEnv.bodies.length, 1)
    const setup = await cli({ ...env, DISCORD_WEBHOOK: fromEnv.url }, 'setup', saved.url)
    assert.equal(setup.json['shadowedBy'], 'DISCORD_WEBHOOK')
  } finally {
    saved.server.close()
    fromEnv.server.close()
  }
})

test('a machine with no webhook refuses the send and says how to set one', async () => {
  const sent = await cli(await machine(), 'send', 'hi')
  assert.equal(sent.code, 1)
  assert.equal(sent.json['reason'], 'no-webhook')
  assert.match(sent.err, /discord setup/)
})

test('a webhook that refuses the post is a failure with its answer', async () => {
  const { url, server } = await hook(404)
  try {
    const sent = await cli({ DISCORD_WEBHOOK: url }, 'send', 'hi')
    assert.equal(sent.code, 1)
    assert.equal(sent.json['reason'], 'not-posted')
    assert.match(sent.err, /404/)
  } finally {
    server.close()
  }
})

test('a failure never prints the webhook: a URL that cannot be posted to, or a server that is not there', async () => {
  for (const webhook of ['https://u:p@discord.com/api/webhooks/1/SECRET', 'discord.com/api/webhooks/1/SECRET', 'http://127.0.0.1:9/api/webhooks/1/SECRET']) {
    const sent = await cli({ DISCORD_WEBHOOK: webhook }, 'send', 'hi')
    assert.equal(sent.code, 1)
    assert.equal(sent.json['reason'], 'not-posted')
    assert.doesNotMatch(JSON.stringify(sent.json) + sent.err, /SECRET/)
  }
})

test('a message over the limit is cut, and says so, never inside an emoji', async () => {
  const { url, bodies, server } = await hook()
  try {
    await cli({ DISCORD_WEBHOOK: url }, 'send', 'x'.repeat(MAX_CONTENT + 50))
    const content = (bodies[0] as { content: string }).content
    assert.equal(content.length, MAX_CONTENT)
    assert.match(content, /\(cut\)$/)
    await cli({ DISCORD_WEBHOOK: url }, 'send', 'x'.repeat(MAX_CONTENT - 9) + '😀'.repeat(20))
    const emoji = (bodies[1] as { content: string }).content
    assert.doesNotMatch(emoji, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no half of an emoji left before the notice')
  } finally {
    server.close()
  }
})

test('setup refuses what is not a web URL; --clear forgets; a bad command line is a usage error', async () => {
  const env = await machine()
  assert.equal((await cli(env, 'setup', 'not a url')).code, 1)
  assert.equal((await cli(env, 'setup', 'ftp://x/y')).code, 1)
  await cli(env, 'setup', 'https://discord.com/api/webhooks/1/x')
  assert.equal((await cli(env, 'setup', '--clear')).code, 0)
  assert.deepEqual((await cli(env, 'status')).json, { ok: true, webhook: false })
  const send = await cli(env, 'send')
  assert.deepEqual([send.code, send.err], [2, 'wrong arguments for send: none\nRun `discord --help` for usage.'])
  const post = await cli(env, 'post', 'hi')
  assert.deepEqual([post.code, post.err], [2, 'unknown command: post\nRun `discord --help` for usage.'])
  assert.equal((await cli(env, 'send', '  ')).json['reason'], 'empty')
})
