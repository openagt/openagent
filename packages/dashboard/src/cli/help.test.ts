import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)

/** The programs OpenAgent ships, each as it is typed with `--help`: the package's own bin, and what follows its name. */
const PROGRAMS: [pkg: string, args: string[]][] = [
  ['@openagt/agent-runner', []],
  ['@openagt/dashboard-devices', []],
  ['@openagt/dashboard-devices', ['server']],
  ['@openagt/skill-account-rotation', []],
  ['@openagt/skill-branches', []],
  ['@openagt/skill-browser', []],
  ['@openagt/skill-discord', []],
  ['@openagt/skill-github', []],
  ['@openagt/skill-logs', []],
  ['@openagt/skill-orchestration', []],
  ['@openagt/skill-queue', []],
  ['@openagt/skill-scheduler', []],
  ['@openagt/skill-tickets', []],
]

function binOf(pkg: string): string {
  const manifest = require.resolve(`${pkg}/package.json`)
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: Record<string, string> }
  return join(dirname(manifest), Object.values(bin)[0]!)
}

test("every program's --help is its usage on stdout, exit 0, in lines a terminal shows whole", async () => {
  const openagent = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'bin.js')
  for (const [bin, args] of [[openagent, []] as [string, string[]], ...PROGRAMS.map(([pkg, args]): [string, string[]] => [binOf(pkg), args])]) {
    const said = [bin, ...args].join(' ')
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [bin, ...args, '--help'])
    assert.equal(stderr, '', said)
    assert.match(stdout, /usage/i, said)
    for (const line of stdout.split('\n')) assert.ok(line.length <= 100, `${said}: ${line}`)
  }
})
