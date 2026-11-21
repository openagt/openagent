// Run the compiled node tests of the package it is run in (its `dist-test/`), the one way every
// package runs them: `node ../../scripts/test-node.mjs [<file>…] [--test-name-pattern=<re>] [--test-timeout=<ms>]`.
//
// - A throwaway config home, removed afterwards (#765). The machine-global state lives at
//   `$XDG_CONFIG_HOME`: the registry, with the developer's own projects, preferences and saved
//   machines. A test that read or wrote the real one would see their projects as its own, and
//   change them.
// - None of the variables an OpenAgent run hands its agent (`OPENAGENT_*`, `AGENT_ID`). An agent
//   that ran a project's tests passed its own skills on, so a test's empty project held tickets and
//   a queue, and seven tests failed in every agent's checkout alone. Kept: `OPENAGENT_NETWORK_TESTS`,
//   which a person sets to run the tests that reach the network. Nor the git identity a run hands
//   its agent, its account's (`GIT_AUTHOR_NAME`, …): it outranks the name a test's repository is
//   given, and a test that read its commit's author read the person's.
// - No coding agent's own CLI: `claude` and `codex` are stand-ins first on PATH that refuse, as on
//   CI where neither is installed. A test that forgot its own stand-in (a `spawn`, a fake driver, a
//   quota source) would start the person's real agent, with its MCP servers and its login: one run
//   of the ui tests started `claude -p /usage` 177 times, 60 at once, on a computer people share. A
//   test that means the real one says so in the agent's environment, `OPENAGENT_TEST_REAL_AGENT=1`:
//   the wire test of Claude Code's questions, which runs only with `OPENAGENT_NETWORK_TESTS`.
// - Outside a terminal, where an agent or CI reads it: a dot per test and every failure in full.
//   Then, last, one line that names the package and its counts, so a failure in a whole-workspace
//   run says where it is.
import { spawn } from 'node:child_process'
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEPT = new Set(['OPENAGENT_NETWORK_TESTS'])
const GIT_IDENTITY = new Set(['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'])
const handedToAgents = name => (name.startsWith('OPENAGENT_') || name === 'AGENT_ID' || GIT_IDENTITY.has(name)) && !KEPT.has(name)

const scratch = mkdtempSync(join(tmpdir(), 'openagent-test-'))
const configHome = join(scratch, 'config')
const summaryFile = join(scratch, 'summary.json')
mkdirSync(configHome)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !handedToAgents(name)))
env.XDG_CONFIG_HOME = configHome
const agents = join(scratch, 'agents')
mkdirSync(agents)
for (const name of ['claude', 'codex']) {
  const real = onPath(name, env.PATH)
  const through = real ? `[ "$OPENAGENT_TEST_REAL_AGENT" = 1 ] && exec '${real}' "$@"\n` : ''
  writeFileSync(join(agents, name), `#!/bin/sh\n${through}echo "${name} is not run in a test: give the test a stand-in for it" >&2\nexit 127\n`, { mode: 0o755 })
}
env.PATH = [agents, env.PATH].filter(Boolean).join(delimiter)

/** The first `name` on `path` that runs; none when it is not there. */
function onPath(name, path = '') {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, name), constants.X_OK)
      return join(dir, name)
    } catch {}
  }
  return undefined
}

const args = process.argv.slice(2)
// Files named on the command line are the run; without any, every compiled test of the package.
const files = args.some(arg => !arg.startsWith('-')) ? [] : ['dist-test/**/*.test.js']
const reporter = process.stdout.isTTY ? 'spec' : 'dot'
const summary = fileURLToPath(new URL('./test-summary.mjs', import.meta.url))

const child = spawn(
  process.execPath,
  [
    '--test',
    '--test-timeout=60000',
    `--test-reporter=${reporter}`,
    '--test-reporter-destination=stdout',
    `--test-reporter=${summary}`,
    `--test-reporter-destination=${summaryFile}`,
    // After the defaults, so a package's own `--test-timeout` wins.
    ...args,
    ...files,
  ],
  { env, stdio: 'inherit' },
)

/** The package's name and how its run went, as one line. */
function said(code) {
  let name = process.cwd()
  try {
    name = JSON.parse(readFileSync('package.json', 'utf8')).name ?? name
  } catch {}
  let run
  try {
    run = JSON.parse(readFileSync(summaryFile, 'utf8'))
  } catch {
    return `✖ ${name}: the node tests ended (exit ${code}) before they said how they went`
  }
  const { tests, passed, failed, cancelled, skipped, todo } = run.counts
  const parts = [`${tests} tests`, `${passed} passed`]
  if (failed) parts.push(`${failed} failed`)
  if (cancelled) parts.push(`${cancelled} cancelled`)
  if (skipped) parts.push(`${skipped} skipped`)
  if (todo) parts.push(`${todo} todo`)
  return `${run.success && code === 0 ? '✔' : '✖'} ${name}: ${parts.join(', ')} (${(run.duration_ms / 1000).toFixed(1)}s)`
}

// Ctrl+C reaches the test run too: wait for it to end, then clean up.
process.on('SIGINT', () => {})
const cleanup = () => rmSync(scratch, { recursive: true, force: true })
child.on('error', err => {
  cleanup()
  throw err
})
child.on('close', (code, signal) => {
  const exit = signal ? 1 : (code ?? 1)
  console.log(`\n${said(exit)}`)
  cleanup()
  process.exit(exit)
})
