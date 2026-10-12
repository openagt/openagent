import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SERVICE_UNIT, STEPS, STEP_IDS, linkScript, quoted } from './steps.js'

const run = promisify(execFile)
const FACTS = { address: '203.0.113.5', version: '1.2.3' }

/** Run a text as a shell script, fed where a program would read, as `ssh` feeds it. */
function sh(script: string, args: string[] = [], at?: { env: NodeJS.ProcessEnv; cwd: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile('bash', ['-s', ...args], at ?? {}, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve({ stdout, stderr })))
    child.stdin!.end(script)
  })
}

test('the steps are the install\'s own, in order, and each is a script a shell reads', async () => {
  assert.deepEqual(STEPS.map(step => step.id), [...STEP_IDS])
  for (const text of [...STEPS.map(step => step.script(FACTS)), linkScript()]) {
    // Read, not run: `-n` only checks that the shell can read all of it.
    await run('bash', ['-n', '-c', text])
  }
})

test('what a script is written for reaches it as one word, whatever it holds', async () => {
  const odd = `it's $(echo no) "quoted" \`no\` ; rm -rf / \\`
  assert.equal((await sh(`printf %s ${quoted(odd)}`)).stdout, odd)
  const door = STEPS.find(step => step.id === 'door')!.script(FACTS)
  assert.match(door, /^ADDRESS='203\.0\.113\.5'$/m)
  assert.match(STEPS.find(step => step.id === 'openagent')!.script(FACTS), /^VERSION='1\.2\.3'$/m)
})

test('a script is a function called with nothing to read: a program it starts cannot eat the rest of it', async () => {
  for (const step of STEPS) {
    const text = step.script(FACTS)
    assert.match(text, /^set -euo pipefail\n/)
    assert.match(text, /\nmain <\/dev\/null\n$/)
  }
})

test('root installs, and what runs afterwards runs as the server\'s own user', () => {
  assert.deepEqual(
    STEPS.map(step => [step.id, step.as]),
    [['login', 'root'], ['user', 'root'], ['tools', 'root'], ['name', 'openagent'], ['openagent', 'root'], ['agent', 'openagent'], ['service', 'root'], ['door', 'openagent']],
  )
  assert.match(SERVICE_UNIT, /^User=openagent$/m)
  // The one right the service has beyond its user's: ports 80 and 443, which the door listens on.
  assert.match(SERVICE_UNIT, /^AmbientCapabilities=CAP_NET_BIND_SERVICE$/m)
  assert.match(SERVICE_UNIT, /^Restart=always$/m)
  assert.match(SERVICE_UNIT, /^WantedBy=multi-user\.target$/m)
})

test('root finds its programs in the system\'s own folders, holds the install alone, and runs nothing a package brought', () => {
  for (const step of STEPS) {
    const text = step.script(FACTS)
    const path = /^export PATH="(.*)"$/m.exec(text)![1]!
    if (step.as === 'root') {
      assert.equal(path, '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', step.id)
      assert.match(text, /^flock -n 9 \|\| fail "Another install is still at work on this server\. Try again in a moment\."$/m, step.id)
    } else {
      assert.match(path, /^\$HOME\/\.local\/bin:\/opt\/openagent\/node\/bin:/, step.id)
      assert.doesNotMatch(text, /flock/, step.id)
    }
  }
  const text = (id: string): string => STEPS.find(step => step.id === id)!.script(FACTS)
  // Unpacked as root's, whoever the download names as the files' owner.
  assert.match(text('tools'), /tar -xJf .* --no-same-owner$/m)
  // The version is read off a file: OpenAgent itself is not started by root, and no package's script is.
  assert.doesNotMatch(text('openagent'), /bin\/openagent --version/)
  assert.match(text('openagent'), /npm install --global --ignore-scripts /)
})

test('the first step refuses a server that is no Ubuntu or Debian in words, before anything is installed', async () => {
  const login = STEPS.find(step => step.id === 'login')!.script(FACTS)
  // The same script, reading another system's name where the server keeps its own.
  // And nothing of a Linux server's own that this computer may not have: its lock is taken for held by nobody.
  const elsewhere = login.replace('. /etc/os-release 2>/dev/null || true', 'ID=fedora; PRETTY_NAME="Fedora Linux 40"').replace(/^exec 9>.*$/m, 'flock() { :; }')
  assert.notEqual(elsewhere, login)
  assert.doesNotMatch(elsewhere, /^exec 9>/m)
  await assert.rejects(sh(elsewhere), (error: { stderr: string }) => {
    assert.equal(error.stderr.trim(), 'OpenAgent installs on Ubuntu and Debian. This server runs Fedora Linux 40.')
    return true
  })
})

test('a server\'s git gets this computer\'s name and email where it has none; what it has stays, and with nothing to give the step says what to do', async () => {
  const name = (facts: { name?: string; email?: string }): string => STEPS.find(step => step.id === 'name')!.script({ ...FACTS, ...facts })
  const base = await mkdtemp(join(tmpdir(), 'servers-git-'))
  // A home of the server's user, with a git that reads nothing but that home: not this computer's own settings.
  const server = async (dir: string): Promise<{ run: (facts: { name?: string; email?: string }) => Promise<unknown>; has: (key: string) => Promise<string>; home: string }> => {
    const home = join(base, dir)
    await mkdir(home)
    const env = { HOME: home, GIT_CONFIG_NOSYSTEM: '1' }
    const git = (args: string[]): Promise<{ stdout: string }> => run('git', args, { cwd: home, env: { ...env, PATH: process.env['PATH'] } })
    return { home, run: facts => sh(name(facts), [], { env, cwd: home }), has: async key => (await git(['config', '--global', '--get', key]).catch(() => ({ stdout: '' }))).stdout.replace(/\n$/, '') }
  }
  const refused = (what: string) => (error: { stderr: string }) => {
    assert.equal(error.stderr, `The server's git has no ${what}, and this computer's git has none to give: nothing an agent does there could be saved. Give this computer both, then try again:\n  git config --global user.name 'Your Name'\n  git config --global user.email 'you@example.com'\n`)
    return true
  }
  try {
    // Nothing to give, and nothing there: refused in words, and nothing written.
    const bare = await server('bare')
    await assert.rejects(bare.run({}), refused('name'))
    await assert.rejects(readFile(join(bare.home, '.gitconfig')), { code: 'ENOENT' })
    // A name alone is no identity: refused the same, and the name is not written either.
    await assert.rejects(bare.run({ name: 'Mona Octocat' }), refused('email'))
    assert.equal(await bare.has('user.name'), '')

    // Both arrive whole, whatever they hold.
    const odd = `-O'Brien "the \`$(echo no)\`" \\\nsecond line`
    await bare.run({ name: odd, email: '--mona@example.com' })
    assert.equal(await bare.has('user.name'), odd)
    assert.equal(await bare.has('user.email'), '--mona@example.com')
    // What the server's git already has is someone's own there, and stays.
    await bare.run({ name: 'Another Name', email: 'another@example.com' })
    assert.equal(await bare.has('user.name'), odd)
    assert.equal(await bare.has('user.email'), '--mona@example.com')
    // With nothing to give either: the server needs nothing.
    await bare.run({})

    // A server that has the one gets only the other.
    const half = await server('half')
    await run('git', ['config', '--global', 'user.name', 'Its Own Name'], { env: { HOME: half.home, GIT_CONFIG_NOSYSTEM: '1', PATH: process.env['PATH'] } })
    await assert.rejects(half.run({ name: 'Mona Octocat' }), refused('email'))
    await half.run({ name: 'Mona Octocat', email: 'mona@example.com' })
    assert.equal(await half.has('user.name'), 'Its Own Name')
    assert.equal(await half.has('user.email'), 'mona@example.com')

    // A name a project in the home folder keeps for itself is no name of the server's: every other project is still without one.
    const project = await server('project')
    const inside = { cwd: project.home, env: { HOME: project.home, GIT_CONFIG_NOSYSTEM: '1', PATH: process.env['PATH'] } }
    await run('git', ['init', '-q', '-b', 'main'], inside)
    await run('git', ['config', 'user.name', 'This Folder Only'], inside)
    await run('git', ['config', 'user.email', 'folder@example.com'], inside)
    await assert.rejects(project.run({}), refused('name'))
    await project.run({ name: 'Mona Octocat', email: 'mona@example.com' })
    assert.equal(await project.has('user.name'), 'Mona Octocat')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
