import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from './install.js'
import { AlreadyAtWork, changeLogin, mintClaude, mintedIn, notMinted, scrubbed, type LoginOptions, type Mint } from './logins.js'
import { CLAUDE_FILE, SERVICE_UNIT, STEPS, claudeLoginScript, claudeLogoutScript, githubLoginScript, githubLogoutScript } from './steps.js'
import { freshSteps, readStore, storePath, update, type LoginKind } from './store.js'
import { GH_LOGIN, pretendServer, testHome } from './test-home.js'

const SERVER = { address: '203.0.113.5', user: 'root' }
/** A Claude login as Claude Code shows one, made up. */
const CLAUDE_LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`
const AS_SERVER_USER = "runuser -l openagent -c 'bash -s'"

async function saved(env: NodeJS.ProcessEnv, over: object = {}): Promise<void> {
  await update(env, store => void store.servers.push({ ...SERVER, steps: freshSteps().map(step => ({ ...step, state: 'done' as const })), adding: false, ...over }))
}

const serverOf = async (env: NodeJS.ProcessEnv) => (await readStore(env)).servers[0]!
/** What the file holds, as it is on disk: where a login must never be. */
const onDisk = (env: NodeJS.ProcessEnv): Promise<string> => readFile(storePath(env), 'utf8')

const give = (env: NodeJS.ProcessEnv, kind: LoginKind, over: Partial<LoginOptions> = {}): Promise<void> => changeLogin({ env, address: SERVER.address, kind, remove: false, ...over })
const take = (env: NodeJS.ProcessEnv, kind: LoginKind, over: Partial<LoginOptions> = {}): Promise<void> => changeLogin({ env, address: SERVER.address, kind, remove: true, ...over })

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

test('every login script is one a shell reads, runs as who it should, and holds the login as one word of its own', async () => {
  const scripts = [githubLoginScript(GH_LOGIN), githubLogoutScript(), claudeLoginScript(CLAUDE_LOGIN), claudeLogoutScript()]
  for (const { script } of scripts) {
    await new Promise<void>((resolve, reject) => execFile('bash', ['-n', '-c', script], error => (error ? reject(error) : resolve())))
    assert.match(script, /\nmain <\/dev\/null\n$/)
  }
  assert.deepEqual(scripts.map(({ as }) => as), ['openagent', 'openagent', 'root', 'root'])
  // A word of the script, not one given on to the programs the script starts.
  assert.match(scripts[0]!.script, new RegExp(`^LOGIN='${GH_LOGIN}'$`, 'm'))
  assert.match(scripts[2]!.script, new RegExp(`^LOGIN='${CLAUDE_LOGIN}'$`, 'm'))
  for (const { script } of scripts) assert.doesNotMatch(script, /export LOGIN/)
  // Root's scripts hold the server alone, as an install does, with a lock where only root writes.
  for (const index of [2, 3]) {
    assert.match(scripts[index]!.script, /^exec 9>\/run\/openagent-install\.lock$/m)
    assert.match(scripts[index]!.script, /^flock -n 9 \|\| fail /m)
  }
  // The Claude login is kept where the service reads it as it starts, in a file that is root's.
  assert.equal(CLAUDE_FILE, '/etc/openagent/claude.env')
  assert.match(SERVICE_UNIT, /^EnvironmentFile=-\/etc\/openagent\/claude\.env$/m)
  // The install brings the gh the login is given to.
  assert.match(STEPS.find(step => step.id === 'tools')!.script({ address: SERVER.address, version: '1.2.3' }), /signed-by=\/etc\/apt\/keyrings\/githubcli-archive-keyring\.gpg\] https:\/\/cli\.github\.com\/packages stable main/)
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

test('on the server the Claude login is asked of Claude Code first, then written to a file only root reads, then OpenAgent is started with it; when that fails the file is as it was', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'servers-claude-'))
  try {
    const bin = join(dir, 'bin')
    await mkdir(bin)
    await mkdir(join(dir, 'proc', '4242'), { recursive: true })
    const file = join(dir, 'etc', 'claude.env')
    const log = join(dir, 'log')
    // The server's own programs, each writing down what it was started with. The service "starts" with what the file holds.
    const noted = `echo "$(basename "$0"): $*" >> ${log}`
    await program(join(bin, 'flock'), `#!/bin/bash\nexit 0\n`)
    await program(join(bin, 'sleep'), `#!/bin/bash\nexit 0\n`)
    await program(join(bin, 'journalctl'), `#!/bin/bash\necho "the service's last words" \nexit 0\n`)
    await program(join(bin, 'timeout'), `#!/bin/bash\n${noted}\nshift\nexec "$@"\n`)
    await program(join(bin, 'runuser'), `#!/bin/bash\n${noted}\nwhile [ "$1" != "--" ]; do shift; done; shift\nexec "$@"\n`)
    await program(join(bin, 'curl'), `#!/bin/bash\n[ -e ${dir}/down ] && exit 7\nexit 0\n`)
    await program(
      join(bin, 'systemctl'),
      `#!/bin/bash\n${noted}\n[ "$1" = show ] && { echo 4242; exit 0; }\nif [ "$1" = restart ]; then : > ${dir}/proc/4242/environ; [ -e ${file} ] && tr '\\n' '\\0' < ${file} > ${dir}/proc/4242/environ; fi\nexit 0\n`,
    )
    await program(
      join(bin, 'claude'),
      `#!/bin/bash\n${noted}\n[ -e ${file} ] && echo "claude: asked after the file was written" >> ${log}\n{ true >&9; } 2>/dev/null && echo "claude: holds root's lock" >> ${log}\nif [ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ ! -e ${dir}/refuses ]; then echo '{ "loggedIn": true }'; else echo '{ "loggedIn": false }'; fi\n`,
    )
    /** The script, with this folder where the server's own folders are, and the programs above where the system's are. */
    const here = (script: string): string =>
      script
        .replace(/^export PATH=.*$/m, `export PATH="${bin}:$PATH"`)
        .replace(/^exec 9>.*$/m, `exec 9>${dir}/lock`)
        .replaceAll('/etc/openagent', join(dir, 'etc'))
        .replaceAll('/home/openagent/.local/bin/claude', join(bin, 'claude'))
        .replaceAll('"/proc/', `"${dir}/proc/`)
    const run = (login: string) => sh(here(claudeLoginScript(login).script), { PATH: process.env.PATH, HOME: dir })
    const words = async (): Promise<string> => readFile(log, 'utf8').catch(() => '')

    const first = await run(CLAUDE_LOGIN)
    assert.equal(first.code, 0, first.stderr)
    assert.equal(await readFile(file, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_LOGIN}\n`)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    const said = await words()
    // Asked as the server's user, for half a minute at most, before anything is written, and without root's lock.
    assert.match(said, /^timeout: 30 runuser -u openagent -- env HOME=\/home\/openagent \S+\/claude auth status$/m)
    assert.match(said, /^claude: auth status$/m)
    assert.doesNotMatch(said, /asked after the file was written|holds root's lock/)
    assert.match(said, /^systemctl: restart openagent$/m)
    // On no command line of any of them.
    assert.ok(!said.includes(CLAUDE_LOGIN))

    // A login Claude Code does not take is not written, and the service is not started again.
    await writeFile(join(dir, 'refuses'), '')
    await writeFile(log, '')
    const other = CLAUDE_LOGIN.replace('Zx9', 'Other')
    const refused = await run(other)
    assert.equal(refused.code, 1)
    assert.equal(refused.stderr.trim(), 'Claude Code on this server does not take the login.')
    assert.equal(await readFile(file, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_LOGIN}\n`)
    assert.doesNotMatch(await words(), /systemctl/)
    await rm(join(dir, 'refuses'))

    // What is no login's letters is written nowhere: a line of its own in that file would be a setting of the service.
    for (const odd of [`${CLAUDE_LOGIN}\nLD_PRELOAD=/tmp/x.so`, `${CLAUDE_LOGIN} x`, '', 'a"b']) {
      const bad = await run(odd)
      assert.equal(bad.code, 1, JSON.stringify(odd))
      assert.equal(bad.stderr.trim(), 'What was sent is no Claude login.')
    }
    assert.equal(await readFile(file, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_LOGIN}\n`)

    // OpenAgent does not start with the new login: the login the server had is put back, and nothing is left beside it.
    await writeFile(join(dir, 'down'), '')
    const failed = await run(other)
    assert.equal(failed.code, 1)
    assert.match(failed.stderr, /the service's last words\nOpenAgent did not start with the login\. The server's Claude login is as it was before\.\n$/)
    assert.equal(await readFile(file, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_LOGIN}\n`)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await assert.rejects(readFile(`${file}.old`), { code: 'ENOENT' })
    await assert.rejects(readFile(`${file}.new`), { code: 'ENOENT' })

    // The same on a server that had none: it has none afterwards.
    await rm(file)
    assert.equal((await run(other)).code, 1)
    await assert.rejects(readFile(file), { code: 'ENOENT' })
    await rm(join(dir, 'down'))

    // Taken off: the file is gone and OpenAgent is started again; a second time there is nothing to do.
    assert.equal((await run(CLAUDE_LOGIN)).code, 0)
    await writeFile(log, '')
    const off = here(claudeLogoutScript().script)
    assert.equal((await sh(off, { PATH: process.env.PATH, HOME: dir })).code, 0)
    await assert.rejects(readFile(file), { code: 'ENOENT' })
    assert.match(await words(), /^systemctl: restart openagent$/m)
    await writeFile(log, '')
    assert.equal((await sh(off, { PATH: process.env.PATH, HOME: dir })).code, 0)
    assert.equal(await words(), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('copying the GitHub login reads it from this computer\'s gh and sends it as the server\'s own user; the file keeps whose it is and since when, never the login', async () => {
  const home = await testHome()
  try {
    await saved(home.env, { github: { failed: 'an older failure' } })
    const { exec, calls, asked } = pretendServer(call => (call.remote === AS_SERVER_USER ? { out: 'Logged in\noctocat\n' } : undefined))
    await give(home.env, 'github', { exec })
    assert.deepEqual(asked, ['auth token --hostname github.com'])
    // The first meeting, then the one script: a server that shows another key is refused before anything is sent.
    assert.deepEqual(calls.map(call => call.remote), ['true', AS_SERVER_USER])
    assert.equal(calls[1]!.script, githubLoginScript(GH_LOGIN).script)
    // The login is fed to ssh, never given to it as a word.
    for (const call of calls) assert.ok(!call.args.join(' ').includes(GH_LOGIN))
    const { github } = await serverOf(home.env)
    assert.deepEqual(Object.keys(github!).sort(), ['account', 'since'])
    assert.equal(github!.account, 'octocat')
    assert.ok(Date.now() - Date.parse(github!.since!) < 5_000)
    assert.ok(!(await onDisk(home.env)).includes(GH_LOGIN))
  } finally {
    await home.remove()
  }
})

test('a copy that fails says why without the login, whatever the server repeats; a server that was sent the login is no longer counted on to have one, one that was not reached keeps what it had', async () => {
  const home = await testHome()
  try {
    const before = { since: '2026-10-01T00:00:00.000Z', account: 'octocat' }
    await saved(home.env, { github: before })
    const github = async () => (await serverOf(home.env)).github

    const none = pretendServer(undefined, args => (args[0] === 'auth' ? { code: 1, out: '', err: 'no oauth token found for github.com' } : undefined))
    await give(home.env, 'github', { exec: none.exec })
    assert.deepEqual(await github(), { ...before, failed: 'There is no GitHub login to copy from this computer. `gh` is not logged in to github.com here: run `gh auth login`.' })
    // Nothing but the meeting was asked of the server.
    assert.deepEqual(none.calls.map(call => call.remote), ['true'])

    const absent = pretendServer(undefined, () => ({ code: null, out: '', err: 'gh could not start: spawn gh ENOENT' }))
    await give(home.env, 'github', { exec: absent.exec })
    assert.deepEqual(await github(), { ...before, failed: 'There is no GitHub login to copy from this computer. `gh` is not on this computer.' })

    // What is no login is sent nowhere.
    const odd = pretendServer(undefined, args => (args[0] === 'auth' ? { out: "x'; rm -rf / #\n" } : undefined))
    await give(home.env, 'github', { exec: odd.exec })
    assert.deepEqual(odd.calls.map(call => call.remote), ['true'])
    assert.equal((await github())!.since, before.since)

    const unmet = pretendServer(() => ({ code: 255, err: '@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed.' }))
    await give(home.env, 'github', { exec: unmet.exec })
    assert.match((await github())!.failed!, /This server shows another key than the one this computer remembers for it\. Nothing was sent to it\.$/)
    assert.deepEqual(unmet.asked, [])
    assert.equal((await github())!.since, before.since)

    const loud = pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, out: `+ gh auth login <<< ${GH_LOGIN}`, err: `error validating token ${GH_LOGIN}: HTTP 401: Bad credentials` }))
    await give(home.env, 'github', { exec: loud.exec })
    assert.deepEqual(await github(), { failed: '+ gh auth login <<< •••\nerror validating token •••: HTTP 401: Bad credentials' })
    assert.ok(!(await onDisk(home.env)).includes(GH_LOGIN))

    const mute = pretendServer(call => (call.remote === 'true' ? undefined : { out: 'Welcome to Debian\n$(reboot)\n' }))
    await give(home.env, 'github', { exec: mute.exec })
    assert.deepEqual(await github(), { failed: 'The server took the login and did not say whose it is.' })
  } finally {
    await home.remove()
  }
})

test('the install copies the GitHub login at its end when the person ticked it; a copy that fails is told on its own line and the server is installed all the same', async () => {
  const home = await testHome()
  try {
    await update(home.env, store => void store.servers.push({ ...SERVER, steps: freshSteps(), adding: true, github: { wanted: true } }))
    const good = pretendServer(call => (call.script === githubLoginScript(GH_LOGIN).script ? { out: 'octocat\n' } : undefined))
    await install({ env: home.env, address: SERVER.address, version: '1.2.3', exec: good.exec })
    // On the line the steps ran on, after the last of them.
    assert.equal(good.calls.length, STEPS.length + 2)
    assert.equal(good.calls.at(-1)!.script, githubLoginScript(GH_LOGIN).script)
    const { github, steps, worker } = await serverOf(home.env)
    assert.equal(github!.account, 'octocat')
    assert.equal(github!.wanted, undefined)
    assert.ok(steps.every(step => step.state === 'done'))
    assert.equal(worker, undefined)

    // Not ticked: not copied, at an update either.
    const again = pretendServer()
    await update(home.env, store => void delete store.servers[0]!.github)
    await install({ env: home.env, address: SERVER.address, version: '1.2.4', exec: again.exec })
    assert.equal(again.calls.length, STEPS.length + 1)
    assert.deepEqual(again.asked, [])

    await update(home.env, store => void (store.servers[0]!.github = { wanted: true }))
    const bad = pretendServer(call => (call.script === githubLoginScript(GH_LOGIN).script ? { code: 1, err: `HTTP 401 for ${GH_LOGIN}` } : undefined))
    await install({ env: home.env, address: SERVER.address, version: '1.2.4', exec: bad.exec })
    const failed = await serverOf(home.env)
    assert.deepEqual(failed.github, { failed: 'HTTP 401 for •••' })
    assert.ok(failed.steps.every(step => step.state === 'done'))

    // A step that fails ends the install before any login is read.
    await update(home.env, store => void (store.servers[0]!.github = { wanted: true }))
    const broken = pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, err: 'no' }))
    await install({ env: home.env, address: SERVER.address, version: '1.2.4', exec: broken.exec })
    assert.deepEqual(broken.asked, [])
    assert.deepEqual((await serverOf(home.env)).github, { wanted: true })
  } finally {
    await home.remove()
  }
})

test('taking a login off the server runs as who keeps it, and forgets it here once the server said it is gone', async () => {
  const home = await testHome()
  try {
    const there = { since: '2026-10-01T00:00:00.000Z' }
    await saved(home.env, { github: { ...there, account: 'octocat' }, claude: there })

    const down = pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, err: 'OpenAgent did not start on this server.' }))
    await take(home.env, 'claude', { exec: down.exec })
    assert.deepEqual((await serverOf(home.env)).claude, { ...there, failed: 'OpenAgent did not start on this server.' })

    const { exec, calls } = pretendServer()
    await take(home.env, 'github', { exec })
    await take(home.env, 'claude', { exec })
    assert.deepEqual(calls.map(call => call.remote), ['true', AS_SERVER_USER, 'true', 'bash -s'])
    assert.equal(calls[1]!.script, githubLogoutScript().script)
    assert.equal(calls[3]!.script, claudeLogoutScript().script)
    const server = await serverOf(home.env)
    assert.equal(server.github, undefined)
    assert.equal(server.claude, undefined)
  } finally {
    await home.remove()
  }
})

/** What Claude Code draws once the person said yes, as a terminal gets it. */
const screen = (login: string): string =>
  `\x1b[?25l\x1b[2K\x1b[1A\x1b[2K\x1b[G\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\n\x1b[33m${login}\x1b[39m\r\n\r\n\x1b[2mStore this token securely. You won't be able to see it again.\x1b[22m\r\n\x1b[2mUse this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\x1b[22m\r\n`

test('the Claude login is read off what Claude Code shows once all of it is there, and only what reads as one; what is told of a failure never holds a part of one', () => {
  assert.equal(mintedIn(screen(CLAUDE_LOGIN)), CLAUDE_LOGIN)
  // Drawn again, as a terminal's screen is: still the one login.
  assert.equal(mintedIn(screen(CLAUDE_LOGIN) + screen(CLAUDE_LOGIN)), CLAUDE_LOGIN)
  // Half a screen is no login: the rest of it may still come.
  const whole = screen(CLAUDE_LOGIN)
  assert.equal(mintedIn(whole.slice(0, whole.indexOf(CLAUDE_LOGIN) + 40)), undefined)
  assert.equal(mintedIn(whole.slice(0, whole.indexOf('Store this'))), undefined)
  assert.equal(mintedIn("Browser didn't open? Use the url below to sign in\r\nhttps://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e\r\n"), undefined)
  // Other letters in the login's place are not one, and neither is a login with something drawn into it.
  assert.equal(mintedIn(screen('a'.repeat(80))), undefined)
  assert.equal(mintedIn(screen(`${CLAUDE_LOGIN.slice(0, 50)} ${CLAUDE_LOGIN.slice(50)}`)), undefined)

  assert.equal(notMinted('started as 4242\r\n\x1b[31mThis command requires a Claude subscription.\x1b[39m\r\n\r\nGoodbye\r\nGoodbye\r\n'), 'Claude Code ended without a login.\nThis command requires a Claude subscription.\nGoodbye')
  const cut = notMinted(whole.slice(0, whole.indexOf(CLAUDE_LOGIN) + 40))
  assert.equal(cut, 'Claude Code made a login, and this OpenAgent could not read it off what Claude Code showed.')
  assert.equal(scrubbed(`a ${CLAUDE_LOGIN} b ${CLAUDE_LOGIN}`, CLAUDE_LOGIN), 'a ••• b •••')
  assert.equal(scrubbed('nothing to hide', ''), 'nothing to hide')
})

test('a program that draws on a terminal is lent one, wide enough for a login on one line; one that ends without a login, takes too long or is stopped is told so, and nothing is left running, even a program that does not heed a terminal that went away', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'servers-mint-'))
  try {
    // Stands in for Claude Code: it needs a terminal, as Claude Code does, and draws what Claude Code draws.
    const stub = join(dir, 'stub.mjs')
    await writeFile(
      stub,
      `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(join(dir, 'pid'))}, String(process.pid))
if (!process.stdout.isTTY || !process.stdin.isTTY) { console.log('no terminal'); process.exit(1) }
process.stdin.setRawMode(true)
process.stdin.on('data', key => console.log('a key nobody pressed', JSON.stringify(String(key))))
const how = process.argv[2]
if (how === 'refuse') { console.log('This command requires a Claude subscription.'); process.exit(1) }
if (how === 'deaf') { process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}) }
if (how === 'wait' || how === 'deaf') setInterval(() => {}, 1000)
else setTimeout(() => {
  if (process.stdout.columns < 200) console.log('too narrow', process.stdout.columns)
  else process.stdout.write(${JSON.stringify(screen(CLAUDE_LOGIN))})
  setInterval(() => {}, 1000)
}, 100)
`,
    )
    const command = (how: string): string => `node ${stub} ${how}`
    const gone = async (): Promise<boolean> => {
      const pid = Number(await readFile(join(dir, 'pid'), 'utf8'))
      for (let tries = 0; tries < 40; tries++) {
        try {
          process.kill(pid, 0)
        } catch {
          return true
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return false
    }

    assert.deepEqual(await mintClaude({ command: command('show') }), { ok: true, login: CLAUDE_LOGIN })
    // It would have gone on for ever: it was ended with the login in hand.
    assert.equal(await gone(), true)

    assert.deepEqual(await mintClaude({ command: command('refuse') }), { ok: false, error: 'Claude Code ended without a login.\nThis command requires a Claude subscription.' })
    assert.deepEqual(await mintClaude({ command: 'no-such-program-here setup-token' }), { ok: false, error: 'Claude Code ended without a login.\nClaude Code is not on this computer.' })

    const late = await mintClaude({ command: command('wait'), timeoutMs: 600 })
    assert.deepEqual(late, { ok: false, error: 'No yes came from the browser in 0 minutes.' })
    assert.equal(await gone(), true)

    assert.equal((await mintClaude({ command: command('deaf'), timeoutMs: 600 })).ok, false)
    assert.equal(await gone(), true)

    const stop = new AbortController()
    setTimeout(() => stop.abort(), 300)
    assert.deepEqual(await mintClaude({ command: command('wait'), signal: stop.signal }), { ok: false, error: 'The login was stopped.' })
    assert.equal(await gone(), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a Claude login is made, given to the server as root, and written down with its day; the login is in no file here', async () => {
  const home = await testHome()
  try {
    await saved(home.env)
    // While the person is asked, the file says so: only then is a second press a new start.
    const during: unknown[] = []
    const mint: Mint = async () => {
      const { claude } = await serverOf(home.env)
      during.push(claude!.asking, claude!.worker!.pid)
      return { ok: true, login: CLAUDE_LOGIN }
    }
    const { exec, calls, asked } = pretendServer()
    await give(home.env, 'claude', { exec, mint })
    assert.deepEqual(during, [true, process.pid])
    assert.deepEqual(calls.map(call => call.remote), ['true', 'bash -s'])
    assert.equal(calls[1]!.script, claudeLoginScript(CLAUDE_LOGIN).script)
    for (const call of calls) assert.ok(!call.args.join(' ').includes(CLAUDE_LOGIN))
    // This computer's own logins are not asked for: Claude's is made new, and GitHub's is another matter.
    assert.deepEqual(asked, [])
    const { claude } = await serverOf(home.env)
    assert.deepEqual(Object.keys(claude!), ['since'])
    assert.ok(Date.now() - Date.parse(claude!.since!) < 5_000)
    assert.ok(!(await onDisk(home.env)).includes(CLAUDE_LOGIN))
  } finally {
    await home.remove()
  }
})

test('a Claude login that is not made, or not taken by the server, says why without the login, and the login the server had still counts', async () => {
  const home = await testHome()
  try {
    const before = '2026-01-01T00:00:00.000Z'
    await saved(home.env, { claude: { since: before, failed: 'an older failure' } })

    const untouched = pretendServer()
    await give(home.env, 'claude', { exec: untouched.exec, mint: async () => ({ ok: false, error: 'No yes came from the browser in 10 minutes.' }) })
    assert.deepEqual((await serverOf(home.env)).claude, { since: before, failed: 'No yes came from the browser in 10 minutes.' })
    // A server is not even met for a login that was not made.
    assert.deepEqual(untouched.calls, [])

    const refusing = pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, err: `Claude Code on this server does not take the login.\n${CLAUDE_LOGIN}` }))
    await give(home.env, 'claude', { exec: refusing.exec, mint: async () => ({ ok: true, login: CLAUDE_LOGIN }) })
    assert.deepEqual((await serverOf(home.env)).claude, { since: before, failed: 'Claude Code on this server does not take the login.\n•••' })
    assert.ok(!(await onDisk(home.env)).includes(CLAUDE_LOGIN))

    const stop = new AbortController()
    const stopped: Mint = ({ signal } = {}) => new Promise(resolve => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'The login was stopped.' })))
    setTimeout(() => stop.abort(), 50)
    await give(home.env, 'claude', { exec: pretendServer().exec, mint: stopped, signal: stop.signal })
    assert.deepEqual((await serverOf(home.env)).claude, { since: before, failed: 'The login was stopped.' })
  } finally {
    await home.remove()
  }
})

test('once the server is being told it is told to the end: stopping only ends the wait for the person', async () => {
  const home = await testHome()
  try {
    await saved(home.env)
    const stop = new AbortController()
    const fake = pretendServer()
    // Stopped while the script is on its way: the line is not cut, so the server and this computer agree afterwards.
    const exec: typeof fake.exec = async (bin, args, script, opts) => {
      if (args.at(-1) === 'bash -s') stop.abort()
      assert.equal(opts.signal, undefined)
      return fake.exec(bin, args, script, opts)
    }
    await give(home.env, 'claude', { exec, mint: async () => ({ ok: true, login: CLAUDE_LOGIN }), signal: stop.signal })
    assert.equal(stop.signal.aborted, true)
    assert.deepEqual(Object.keys((await serverOf(home.env)).claude!), ['since'])
  } finally {
    await home.remove()
  }
})

test('while a login is changed the file is told so again and again; one that another process changes is not joined, and one that was started over writes nothing', async () => {
  const home = await testHome()
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  try {
    await saved(home.env)
    const seen: string[] = []
    const slow: Mint = async () => {
      for (let looks = 0; looks < 4; looks++) {
        seen.push((await serverOf(home.env)).claude!.worker!.seen)
        await new Promise(resolve => setTimeout(resolve, 40))
      }
      return { ok: true, login: CLAUDE_LOGIN }
    }
    await give(home.env, 'claude', { exec: pretendServer().exec, mint: slow, beatMs: 10 })
    assert.ok(new Set(seen).size > 1, `said once only: ${seen.join(', ')}`)
    assert.equal((await serverOf(home.env)).claude!.worker, undefined)

    for (const kind of ['claude', 'github'] as const) {
      await update(home.env, store => void (store.servers[0]![kind] = { worker: { pid: other.pid!, seen: new Date().toISOString() } }))
      const second = pretendServer()
      await assert.rejects(give(home.env, kind, { exec: second.exec, mint: slow }), new AlreadyAtWork(SERVER.address, kind))
      await assert.rejects(take(home.env, kind, { exec: second.exec }), AlreadyAtWork)
      assert.deepEqual(second.calls, [])
      assert.deepEqual(second.asked, [])
    }
    // The other login is its own matter.
    await update(home.env, store => void delete store.servers[0]!.github)
    await give(home.env, 'github', { exec: pretendServer(call => (call.remote === 'true' ? undefined : { out: 'octocat\n' })).exec })
    assert.equal((await serverOf(home.env)).github!.account, 'octocat')

    // Started over while this one still asked: the file is the newer one's.
    await update(home.env, store => void delete store.servers[0]!.claude)
    const takenOver: Mint = async () => {
      await update(home.env, store => void (store.servers[0]!.claude = { worker: { pid: other.pid!, seen: new Date().toISOString() }, asking: true }))
      return { ok: false, error: 'The login was stopped.' }
    }
    await give(home.env, 'claude', { exec: pretendServer().exec, mint: takenOver })
    assert.deepEqual(Object.keys((await serverOf(home.env)).claude!).sort(), ['asking', 'worker'])
    assert.equal((await serverOf(home.env)).claude!.worker!.pid, other.pid)
  } finally {
    other.kill()
    await home.remove()
  }
})
