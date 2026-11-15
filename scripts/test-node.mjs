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
//   which a person sets to run the tests that reach the network.
// - Outside a terminal, where an agent or CI reads it: a dot per test and every failure in full.
//   Then, last, one line that names the package and its counts, so a failure in a whole-workspace
//   run says where it is.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEPT = new Set(['OPENAGENT_NETWORK_TESTS'])
const handedToAgents = name => (name.startsWith('OPENAGENT_') || name === 'AGENT_ID') && !KEPT.has(name)

const scratch = mkdtempSync(join(tmpdir(), 'openagent-test-'))
const configHome = join(scratch, 'config')
const summaryFile = join(scratch, 'summary.json')
mkdirSync(configHome)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !handedToAgents(name)))
env.XDG_CONFIG_HOME = configHome

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
