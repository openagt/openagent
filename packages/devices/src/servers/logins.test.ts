import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scrubbed } from './logins.js'
import { SERVICE_UNIT, STEPS, githubLoginScript, githubLogoutScript } from './steps.js'
import { GH_LOGIN } from './test-home.js'

/** A Claude login as Claude Code shows one, made up. */
const CLAUDE_LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`

/** Run a text as a shell script, fed where a program would read, as `ssh` feeds it. */
function sh(script: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = execFile('bash', ['-s'], { env }, (error, stdout, stderr) => resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr }))
    child.stdin!.end(script)
  })
}

async function program(path: string, text: string): Promise<void> {
  await writeFile(path, text)
  await chmod(path, 0o755)
}

test('every login script is one a shell reads, runs as the user, and holds the login as one word of its own', async () => {
  const scripts = [githubLoginScript(GH_LOGIN), githubLogoutScript()]
  for (const { script } of scripts) {
    await new Promise<void>((resolve, reject) => execFile('bash', ['-n', '-c', script], error => (error ? reject(error) : resolve())))
    assert.match(script, /\nmain <\/dev\/null\n$/)
  }
  assert.deepEqual(scripts.map(({ as }) => as), ['openagent', 'openagent'])
  // A word of the script, not one given on to the programs the script starts.
  assert.match(scripts[0]!.script, new RegExp(`^LOGIN='${GH_LOGIN}'$`, 'm'))
  for (const { script } of scripts) assert.doesNotMatch(script, /export LOGIN/)
  // The server's own OpenAgent reads no login from a file: its logins are its own, as OpenAgent keeps them.
  assert.doesNotMatch(SERVICE_UNIT, /EnvironmentFile/)
  // The install brings the gh the login is given to.
  assert.match(STEPS.find(step => step.id === 'tools')!.script({ address: '203.0.113.5', version: '1.2.3' }), /signed-by=\/etc\/apt\/keyrings\/githubcli-archive-keyring\.gpg\] https:\/\/cli\.github\.com\/packages stable main/)
})

test('on the server the GitHub login reaches gh where a program reads, and is on no command line and in nothing a program is given; a step that fails leaves no login behind', async () => {
  const home = await mkdtemp(join(tmpdir(), 'servers-gh-'))
  try {
    // A gh that writes down what it was started with, what it was given, and what it read; it keeps a login as gh does.
    await mkdir(join(home, '.local', 'bin'), { recursive: true })
    await mkdir(join(home, '.config', 'gh'), { recursive: true })
    const kept = join(home, '.config', 'gh', 'hosts.yml')
    await writeFile(kept, 'a login copied before\n')
    await program(
      join(home, '.local', 'bin', 'gh'),
      `#!/bin/bash
{ echo "args: $*"; echo "env: $(env | tr '\\n' ' ')"; [ -e "$HOME/.config/gh/hosts.yml" ] && echo "old login still there"; } >> "$HOME/gh.log"
if [ "$1 $2" = "auth login" ]; then login=$(cat); echo "read: $login" >> "$HOME/gh.log"; echo "kept by gh" > "$HOME/.config/gh/hosts.yml"; fi
[ "$1 $2" = "auth setup-git" ] && [ -e "$HOME/fail-setup" ] && { echo "could not write the git settings" >&2; exit 1; }
[ "$1" = api ] && echo octocat
exit 0
`,
    )
    // The server user's shell says of another place and another login: neither is gh's to take.
    const env = { HOME: home, PATH: process.env.PATH, GH_TOKEN: 'ghp_someoneElses', XDG_CONFIG_HOME: join(home, 'elsewhere') }
    const ran = await sh(githubLoginScript(GH_LOGIN).script, env)
    assert.equal(ran.code, 0, ran.stderr)
    assert.equal(ran.stdout.trim().split('\n').at(-1), 'octocat')
    const log = await readFile(join(home, 'gh.log'), 'utf8')
    assert.deepEqual(log.split('\n').filter(line => line.startsWith('args: ')), ['args: auth login --hostname github.com --git-protocol https --with-token', 'args: auth setup-git --hostname github.com', 'args: api --hostname github.com user --jq .login'])
    assert.deepEqual(log.split('\n').filter(line => line.startsWith('read: ')), [`read: ${GH_LOGIN}`])
    // Read once, where gh reads; nowhere else in what any of the three was started with.
    assert.equal(log.split(GH_LOGIN).length, 2)
    assert.doesNotMatch(log, /ghp_someoneElses|elsewhere/)
    // The login copied before was gone before the first of them ran.
    assert.equal(log.split('\n').filter(line => line === 'old login still there').length, 2)
    assert.equal(await readFile(kept, 'utf8'), 'kept by gh\n')

    // gh took the login, and what comes after failed: the server is left with none, not with one nobody knows of.
    await writeFile(join(home, 'fail-setup'), '')
    const half = await sh(githubLoginScript(GH_LOGIN).script, env)
    assert.equal(half.code, 1)
    assert.match(half.stderr, /could not write the git settings/)
    await assert.rejects(readFile(kept), { code: 'ENOENT' })

    await writeFile(kept, 'kept by gh\n')
    assert.equal((await sh(githubLogoutScript().script, { HOME: home, PATH: process.env.PATH })).code, 0)
    await assert.rejects(readFile(kept), { code: 'ENOENT' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('what is told of a failure never holds the login', () => {
  assert.equal(scrubbed(`a ${CLAUDE_LOGIN} b ${CLAUDE_LOGIN}`, CLAUDE_LOGIN), 'a ••• b •••')
  assert.equal(scrubbed('nothing to hide', ''), 'nothing to hide')
})
