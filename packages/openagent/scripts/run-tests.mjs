// Run the compiled test suite against a throwaway config home (#765).
//
// The machine-global state lives at `$XDG_CONFIG_HOME` (the registry, the daemon state
// file). A test that finds the developer's live daemon there wires the control watcher,
// whose file follower keeps the event loop alive until the test times out, so a dashboard
// user gets false failures. Nothing in the suite should ever read the real one, so the
// isolation belongs here rather than in each test file.
//
// The same goes for the skills every run gets by default: an agent's run names them in
// `OPENAGENT_SKILLS`, and its agent's own test run inherited it, so a test's empty project held
// tickets, a queue and their pages, and seven tests failed in every agent's checkout alone.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function withoutDefaultSkills(env) {
  const { OPENAGENT_SKILLS: _skills, ...rest } = env
  return rest
}

const configHome = mkdtempSync(join(tmpdir(), 'openagent-test-config-'))
const packageDir = fileURLToPath(new URL('..', import.meta.url))

const child = spawn(process.execPath, ['--test', '--test-timeout=60000', ...process.argv.slice(2)], {
  cwd: join(packageDir, 'dist-test'),
  env: { ...withoutDefaultSkills(process.env), XDG_CONFIG_HOME: configHome },
  stdio: 'inherit',
})

const cleanup = () => rmSync(configHome, { recursive: true, force: true })
child.on('error', err => {
  cleanup()
  throw err
})
child.on('close', (code, signal) => {
  cleanup()
  process.exit(signal ? 1 : (code ?? 1))
})
