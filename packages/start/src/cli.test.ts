import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, printStartupFooter, runCli, type CliIO } from './cli.js'
import { openagentVersion } from './version.js'

function capture(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: l => out.push(l), err: l => err.push(l) }, out, err }
}

test('parseArgs keeps three options and no verbs (D4)', () => {
  assert.deepEqual(parseArgs([]), { help: false, version: false })
  assert.equal(parseArgs(['--help']).help, true)
  assert.equal(parseArgs(['-v']).version, true)
  assert.equal(parseArgs(['--port', '0']).port, 0)
  // The command runs no agent (#1774): the old process API is a usage error like any other
  // unknown option, and so is a bare word, what used to be an intent or a verb.
  assert.match(parseArgs(['--agent', '/tmp/s.json']).error!, /unknown/)
  assert.match(parseArgs(['--autopilot']).error!, /unknown option/)
  assert.match(parseArgs(['a blog app']).error!, /unknown command/)
  assert.match(parseArgs(['--port', 'x']).error!, /--port/)
})

test('openagentVersion reports the real package version, not the failed-read placeholder (#312)', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(openagentVersion(), pkg.version)
  // The guard this test exists for: a failed read must not look like a plausible version. The
  // sentinel is `unknown` rather than `0.0.0` because the packages are unreleased and genuinely
  // versioned `0.0.0`, so a numeric fallback would be indistinguishable from a correct read.
  assert.notEqual(openagentVersion(), 'unknown')
})

test('runCli --version prints the real version (#312)', async () => {
  const { io, out } = capture()
  const code = await runCli(['--version'], io)
  assert.equal(code, 0)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.deepEqual(out, [pkg.version])
})

test('parseArgs flags unknown options and bad values', () => {
  assert.match(parseArgs(['--nope']).error!, /unknown option/)
  assert.match(parseArgs(['--port', '-1']).error!, /--port/)
  assert.match(parseArgs(['--port']).error!, /--port/)
  assert.match(parseArgs(['--host', '0.0.0.0']).error!, /unknown option: --host/) // the first unreadable thing is the one told
  // Every flag that configured a run is gone: the command runs no agent, and what a run needs
  // is the project's start hook's business (#1774).
  for (const gone of ['--agent', '--scope', '--max-passes', '--max-cost', '--permission-mode', '--driver', '--run-on']) {
    assert.match(parseArgs([gone]).error!, /unknown option/, gone)
  }
})

test('runCli --help prints usage and exits 0', async () => {
  const { io, out } = capture()
  const code = await runCli(['--help'], io)
  assert.equal(code, 0)
  assert.match(out.join('\n'), /Usage:\n  openagent /)
})

test('runCli usage error exits 2', async () => {
  const { io, err } = capture()
  assert.equal(await runCli(['--bogus'], io), 2)
  assert.ok(err.includes('Run `openagent --help` for usage.'))
})

// The CLI is foreground-only, so there is no `--daemon`, no `stop`, and no background dashboard
// for a bare `openagent` to defer to. Bare `openagent` binds a port and blocks until Ctrl-C, which
// is `runDaemon`'s own contract, covered in daemon.test.ts rather than here.
test('runCli rejects the retired flags and verbs as usage errors (D4/D4b)', async () => {
  // The verbs go with the flags: the dashboard is where a session, a doctor report and a worktree
  // cleanup are asked for, and Ctrl-C is how the foreground dashboard is stopped.
  for (const argv of [['--daemon'], ['--daemon-serve'], ['stop'], ['doctor'], ['maintain'], ['worktrees'], ['prompt', 'hi']]) {
    const { io } = capture()
    assert.equal(await runCli(argv, io), 2, `${argv.join(' ')} is not a command`)
  }
})

test('the startup footer prints the commands and the version (#312)', async () => {
  const { io, out } = capture()
  await printStartupFooter(io, { fetchLatest: async () => openagentVersion() })
  assert.ok(out.includes('Type a prompt on the dashboard to start an agent, or use:'))
  assert.ok(out.includes('  openagent --help              All options'))
  assert.ok(out.includes(`OpenAgent v${openagentVersion()}`))
  assert.ok(out.includes(`✅ Up to date (v${openagentVersion()})`))
})

test('the footer offers no `openagent stop`: Ctrl-C is how the foreground dashboard ends (#312)', async () => {
  const { io, out } = capture()
  await printStartupFooter(io, { fetchLatest: async () => undefined })
  assert.ok(!out.some(l => l.includes('openagent stop')))
  assert.ok(out.includes(`OpenAgent v${openagentVersion()}`))
})

test('the footer offers no positional build command: D4 removed it, and following it exited 2', async () => {
  const { io, out } = capture()
  await printStartupFooter(io, { fetchLatest: async () => undefined })
  assert.ok(!out.some(l => l.includes('<what to build>')))
})

test('the version prints before npm answers, and a newer release is announced after (#312)', async () => {
  const { io, out } = capture()
  let release: (v: string) => void = () => {}
  const pending = printStartupFooter(io, { fetchLatest: () => new Promise<string>(resolve => (release = resolve)) })
  // The static half is out while the registry call is still in flight — bare `openagent` blocks on
  // the server forever, so anything held back until after the await would never be printed there.
  assert.ok(out.includes(`OpenAgent v${openagentVersion()}`))
  assert.ok(!out.some(l => l.includes('Update available')))
  release('999.0.0')
  await pending
  assert.ok(out.some(l => l.includes('⬆️  Update available: v999.0.0')))
})

test('an unreachable npm registry costs the footer nothing (#312)', async () => {
  const { io, out } = capture()
  await printStartupFooter(io, { fetchLatest: () => Promise.reject(new Error('offline')) })
  assert.ok(out.includes(`OpenAgent v${openagentVersion()}`))
  assert.ok(!out.some(l => l.includes('Up to date') || l.includes('Update available')))
})


/** A server on an ephemeral port of this computer, answering with `listener`: what holds the port a second `openagent` is given. */
async function holdPort(listener: RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(listener)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, close: () => new Promise(resolve => server.close(() => resolve())) }
}

/** Run `body` with the registry in a throwaway folder: the dashboard's start reads and writes it before it binds. */
async function withConfig(body: () => Promise<void>): Promise<void> {
  const before = process.env.XDG_CONFIG_HOME
  const dir = await mkdtemp(join(tmpdir(), 'openagent-cli-'))
  process.env.XDG_CONFIG_HOME = dir
  try {
    await body()
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(dir, { recursive: true, force: true })
  }
}

test('a second run hands its repository to the dashboard on the port, prints the address the page shows, and ends (#2141)', async () => {
  const asked: unknown[] = []
  const running = await holdPort((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      asked.push({ path: req.url, args: JSON.parse(body) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ret: { version: openagentVersion(), project: { ok: true, id: 'gemstack-st99l0', path: '/code/gemstack', added: true, address: 'gemstack' } } }))
    })
  })
  try {
    await withConfig(async () => {
      const { io, out, err } = capture()
      assert.equal(await runCli(['--port', String(running.port)], io), 0, err.join('\n'))
      const url = `http://127.0.0.1:${running.port}`
      assert.deepEqual(out, [`◆ dashboard already running: ${url}`, '◆ project added: /code/gemstack', `◆ project: ${url}/gemstack`])
      // Run from inside this repository: that is the folder handed over.
      assert.equal(asked.length, 1)
      assert.match(JSON.stringify(asked[0]), /"path":"\/_rpc\/sendStartedAgain","args":\["\/[^"]+"\]/)
    })
  } finally {
    await running.close()
  }
})

test('a port another program holds is said to be taken, with what to do (#2141)', async () => {
  const other = await holdPort((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>a dev server</html>'))
  try {
    await withConfig(async () => {
      const { io, err } = capture()
      assert.equal(await runCli(['--port', String(other.port)], io), 1)
      assert.deepEqual(err, [`could not start the dashboard: port ${other.port} is taken by another program. Pass --port <n> to use another one.`])
    })
  } finally {
    await other.close()
  }
})
