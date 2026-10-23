import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliIO, type OtherStatus, type OwnStatus, type SharedStatus } from './cli.js'
import { OWN_CLAUDE_FILE, markOf, ownClaudeLoginScript, ownClaudeLogoutScript, ownIdentityScript } from './own.js'
import type { OwnDoor } from './own-door.js'
import type { Exec } from './ssh.js'
import { readStore, storePath } from './store.js'
import { GH_LOGIN, testHome } from './test-home.js'

/** A Claude login as Claude Code shows one, made up. */
const CLAUDE_LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`

interface Ran {
  code: number
  out: unknown
  err: string[]
}

async function run(env: NodeJS.ProcessEnv, args: string[], over: Partial<CliIO> = {}): Promise<Ran> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { env, stdout: line => out.push(line), stderr: line => err.push(line), startWork: () => process.pid, startOver: () => {}, ...over })
  return { code, out: out.length ? (JSON.parse(out.join('\n')) as unknown) : undefined, err }
}

/**
 * This computer's own shell, as a person's OpenAgent runs its login scripts: each script is
 * answered by `answer`, by what it does, and goes well with nothing said otherwise.
 */
function pretendShell(answer: (script: string) => { code?: number; out?: string; err?: string } | undefined = () => undefined): { exec: Exec; scripts: string[] } {
  const scripts: string[] = []
  const exec: Exec = async (bin, args, script) => {
    if (bin !== 'bash' || args.join(' ') !== '-s') throw new Error(`not a script: ${bin} ${args.join(' ')}`)
    scripts.push(script)
    return { code: 0, out: '', err: '', ...answer(script) }
  }
  return { exec, scripts }
}

const GH_GIVEN = /gh auth login --hostname github\.com --git-protocol https --with-token/

test('a person\'s own logins are only on a person\'s OpenAgent: anywhere else own is refused, and nothing is written', async () => {
  const home = await testHome()
  try {
    const refused = await run(home.env, ['own'])
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.err, ["This OpenAgent is no person's on a computer several people use."])
    assert.deepEqual((await run({ ...home.env, OPENAGENT_PERSON: '%0A' }, ['own'])).code, 1)
    const env = { ...home.env, OPENAGENT_PERSON: 'Rom%20Brillout' }
    assert.deepEqual((await run(env, ['own'])).out, { person: 'Rom Brillout', logins: { github: { there: false, working: false }, claude: { there: false, working: false } } } satisfies OwnStatus)
    assert.equal((await run(env, ['own', 'login', 'gitlab'])).code, 2)
  } finally {
    await home.remove()
  }
})

test('a GitHub login handed over on standard input is given to this user\'s gh, whichever account it is, and git gets its name', async () => {
  const home = await testHome()
  try {
    const env = { ...home.env, OPENAGENT_PERSON: 'rom' }
    const shell = pretendShell(script => (GH_GIVEN.test(script) ? { out: 'Rom\n' } : undefined))
    const given = await run(env, ['own', 'login', 'github'], { exec: shell.exec, stdin: async () => `${GH_LOGIN}\n` })
    assert.equal(given.code, 0)
    const github = (given.out as OwnStatus).logins.github
    assert.equal(github.there, true)
    assert.equal(github.account, 'Rom')
    // The login is a word of the script, never in the file; then git is named after the account.
    assert.match(shell.scripts[0]!, new RegExp(`^LOGIN='${GH_LOGIN}'$`, 'm'))
    assert.match(shell.scripts[1]!, /git config --global -- user\.email "\$id\+\$login@users\.noreply\.github\.com"/)
    assert.equal((await readFile(storePath(env), 'utf8')).includes(GH_LOGIN), false)

    // The person is a name, not an account: any account's login is theirs to use.
    const other = pretendShell(script => (GH_GIVEN.test(script) ? { out: 'octocat\n' } : undefined))
    const taken = await run(env, ['own', 'login', 'github'], { exec: other.exec, stdin: async () => GH_LOGIN })
    assert.equal((taken.out as OwnStatus).logins.github.account, 'octocat')

    // What reads as no GitHub login is not sent anywhere.
    const nothing = pretendShell()
    const bad = await run(env, ['own', 'login', 'github'], { exec: nothing.exec, stdin: async () => 'not a login' })
    assert.equal((bad.out as OwnStatus).logins.github.said, 'What was sent is no GitHub login.')
    assert.equal(nothing.scripts.length, 0)
  } finally {
    await home.remove()
  }
})

test('a GitHub login with a code is a process of its own, and a Claude login handed over is written, and OpenAgent is started again with it; a login taken off starts it again only for Claude', async () => {
  const home = await testHome()
  try {
    const env = { ...home.env, OPENAGENT_PERSON: 'rom' }
    const started: string[][] = []
    await run(env, ['own', 'login', 'github', 'own'], { startWork: words => (started.push(words), 4242) })
    assert.deepEqual(started, [['own-work', 'github']])
    assert.equal((await readStore(env)).own?.github?.worker?.pid, 4242)

    let over = 0
    const shell = pretendShell()
    const given = await run(env, ['own', 'login', 'claude'], { exec: shell.exec, stdin: async () => CLAUDE_LOGIN, startOver: () => void over++ })
    assert.equal((given.out as OwnStatus).logins.claude.there, true)
    assert.ok((given.out as OwnStatus).logins.claude.ends)
    assert.equal(over, 1)
    assert.equal((await readFile(storePath(env), 'utf8')).includes(CLAUDE_LOGIN), false)

    // One Claude Code does not take: said without the login, and OpenAgent is left as it is.
    const no = pretendShell(() => ({ code: 1, err: `Claude Code on this computer does not take the login. ${CLAUDE_LOGIN}` }))
    const refused = await run(env, ['own', 'login', 'claude'], { exec: no.exec, stdin: async () => CLAUDE_LOGIN, startOver: () => void over++ })
    assert.equal((refused.out as OwnStatus).logins.claude.said, 'Claude Code on this computer does not take the login. •••')
    assert.equal((refused.out as OwnStatus).logins.claude.there, true, 'the one written before is still there')
    assert.equal(over, 1)

    await run(env, ['own', 'logout', 'github'], { exec: shell.exec, startOver: () => void over++ })
    assert.equal(over, 1)
    const gone = await run(env, ['own', 'logout', 'claude'], { exec: shell.exec, startOver: () => void over++ })
    assert.equal(over, 2)
    assert.deepEqual((gone.out as OwnStatus).logins.claude, { there: false, working: false })
  } finally {
    await home.remove()
  }
})

test('the Claude login is written to a file of the user\'s own that only it reads, once Claude Code takes it; nothing else is ever written there', async () => {
  const home = await mkdtemp(join(tmpdir(), 'servers-own-claude-'))
  const sh = (script: string): Promise<{ code: number; stderr: string }> =>
    new Promise(resolve => {
      const child = execFile('bash', ['-s'], { env: { HOME: home, PATH: '/usr/bin:/bin' } }, (error, _out, stderr) => resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stderr }))
      child.stdin!.end(script)
    })
  try {
    await mkdir(join(home, '.local', 'bin'), { recursive: true })
    const claude = join(home, '.local', 'bin', 'claude')
    // Claude Code that takes the one login it knows, read where a program reads its settings.
    await writeFile(claude, `#!/bin/bash\n[ "$CLAUDE_CODE_OAUTH_TOKEN" = '${CLAUDE_LOGIN}' ] && echo '{"loggedIn": true}' || echo '{"loggedIn": false}'\n`)
    await chmod(claude, 0o755)
    // The server's own `timeout`, which not every computer a test runs on has: it runs what it is given.
    await writeFile(join(home, '.local', 'bin', 'timeout'), '#!/bin/bash\nshift\nexec "$@"\n')
    await chmod(join(home, '.local', 'bin', 'timeout'), 0o755)
    const file = join(home, OWN_CLAUDE_FILE)
    assert.equal((await sh(ownClaudeLoginScript('sk-ant-other-login').script).then(said => said.code)), 1)
    await assert.rejects(stat(file))
    assert.deepEqual(await sh(ownClaudeLoginScript(CLAUDE_LOGIN).script), { code: 0, stderr: '' })
    assert.equal(await readFile(file, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_LOGIN}\n`)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    const odd = await sh(ownClaudeLoginScript('a\nPORT=4200').script)
    assert.equal(odd.code, 1)
    assert.match(odd.stderr, /What was sent is no Claude login\./)
    assert.equal(await readFile(file, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_LOGIN}\n`)
    assert.deepEqual(await sh(ownClaudeLogoutScript().script), { code: 0, stderr: '' })
    await assert.rejects(stat(file))
    await new Promise<void>((resolve, reject) => execFile('bash', ['-n', '-c', ownIdentityScript().script], error => (error ? reject(error) : resolve())))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

/** This computer's own OpenAgent, as far as a command it started meets it: the calls it was asked, and its answers. */
async function openAgent(answer: (fn: string, args: unknown[]) => unknown): Promise<{ url: string; asked: { fn: string; args: unknown[]; origin?: string }[]; close: () => Promise<void> }> {
  const asked: { fn: string; args: unknown[]; origin?: string }[] = []
  const srv: Server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const fn = (req.url ?? '').replace('/_rpc/', '')
      const args = JSON.parse(body) as unknown[]
      asked.push({ fn, args, ...(req.headers.origin ? { origin: req.headers.origin } : {}) })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ret: answer(fn, args) }))
    })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return {
    url,
    asked,
    close: () => {
      srv.closeAllConnections()
      return new Promise<void>(r => srv.close(() => r()))
    },
  }
}

const SERVER_URL = 'https://203.0.113.9'

/** This computer's own door, with the lines it keeps: what it was asked, and what it was handed. */
function pretendDoor(lines: { url: string; mode: string; id?: string; refused?: true }[] = []): { door: OwnDoor; asked: { args: string[]; input?: string }[] } {
  const asked: { args: string[]; input?: string }[] = []
  const door: OwnDoor = async (args, _env, input) => {
    asked.push({ args, ...(input !== undefined ? { input } : {}) })
    if (args[0] === 'status') return { ok: true, out: JSON.stringify({ lines }) }
    if (args[0] === 'line' && args[1] === 'add') lines.push({ url: SERVER_URL, mode: args[3] === 'watch' ? 'watch' : 'full', id: 'l1abcd' })
    if (args[0] === 'line' && (args[1] === 'full' || args[1] === 'watch')) {
      const line = lines.find(kept => kept.url === args[2])
      if (!line) return { ok: false, error: 'no such line' }
      line.mode = args[1]
    }
    if (args[0] === 'line' && args[1] === 'remove') lines.splice(0, lines.length)
    return { ok: true, out: '{}' }
  }
  return { door, asked }
}

test('for a server someone invited this computer\'s person to, this computer\'s GitHub login is copied through OpenAgent, on standard input there, and never in an address', async () => {
  const home = await testHome()
  const agent = await openAgent(fn => (fn === 'runComputerCommandOn' ? { ok: true, output: { person: 'rom', logins: {} } } : undefined))
  try {
    const env = { ...home.env, OPENAGENT_URL: agent.url }
    const gh: Exec = async bin => (bin === 'gh' ? { code: 0, out: `${GH_LOGIN}\n`, err: '' } : { code: 1, out: '', err: '' })
    const copied = await run(env, ['shared-login', SERVER_URL, 'github'], { exec: gh })
    assert.equal(copied.code, 0)
    assert.deepEqual(copied.out, { person: 'rom', logins: {} })
    assert.deepEqual(agent.asked, [{ fn: 'runComputerCommandOn', args: ['@openagt/devices', SERVER_URL, ['own', 'login', 'github'], null, GH_LOGIN], origin: agent.url }])
    // What names no server reached over HTTPS is not one.
    assert.equal((await run(env, ['shared-login', 'http://203.0.113.9', 'github'])).code, 2)
    assert.equal((await run(env, ['shared-login', `${SERVER_URL}/x`, 'github'])).code, 2)
    // Only this computer's own OpenAgent is asked.
    const elsewhere = await run({ ...home.env, OPENAGENT_URL: 'https://203.0.113.7' }, ['shared-login', SERVER_URL, 'github'], { exec: gh })
    assert.equal(elsewhere.code, 1)
  } finally {
    await agent.close()
    await home.remove()
  }
})

test('a Claude login for a shared server is made in this computer\'s browser by a process of its own and handed over through OpenAgent; how it ended is written down, never the login', async () => {
  const home = await testHome()
  let answer: unknown = { ok: true, output: {} }
  const agent = await openAgent(() => answer)
  try {
    const env = { ...home.env, OPENAGENT_URL: agent.url }
    const started: string[][] = []
    const asked = await run(env, ['shared-login', SERVER_URL, 'claude'], { startWork: words => (started.push(words), 4242), door: pretendDoor().door })
    assert.deepEqual(started, [['shared-work', SERVER_URL]])
    assert.equal((asked.out as { shared: SharedStatus[] }).shared[0]!.claude.working, false, 'the process 4242 is not this one: it is not at work')

    // The process itself.
    const minted = await run(env, ['shared-work', SERVER_URL], { mint: async () => ({ ok: true, login: CLAUDE_LOGIN }) })
    assert.equal(minted.code, 0)
    assert.deepEqual(agent.asked.at(-1)?.args, ['@openagt/devices', SERVER_URL, ['own', 'login', 'claude'], null, CLAUDE_LOGIN])
    assert.equal((await readFile(storePath(env), 'utf8')).includes(CLAUDE_LOGIN), false)

    // Started again from the command, as the page does, then made and refused over there: said in the server's words.
    answer = { ok: false, error: 'Claude Code on this computer does not take the login.' }
    await run(env, ['shared-login', SERVER_URL, 'claude'], { startWork: () => process.pid, door: pretendDoor().door })
    await run(env, ['shared-work', SERVER_URL], { mint: async () => ({ ok: true, login: CLAUDE_LOGIN }) })
    const told = await run(env, ['shared', SERVER_URL], { door: pretendDoor().door })
    assert.deepEqual((told.out as { shared: SharedStatus[] }).shared, [{ url: SERVER_URL, claude: { there: false, working: false, said: 'Claude Code on this computer does not take the login.' } }])
  } finally {
    await agent.close()
    await home.remove()
  }
})

test('a line to a shared server is asked for with a link its door gives this person, through OpenAgent, handed to this computer\'s door on standard input; then only what it may do is changed, and off takes it away', async () => {
  const home = await testHome()
  const LINK = `${SERVER_URL}/_devices/enter#c0de.pin`
  const agent = await openAgent(fn => (fn === 'sendMachineLineLink' ? { ok: true, url: LINK } : undefined))
  try {
    const env = { ...home.env, OPENAGENT_URL: agent.url }
    const { door, asked } = pretendDoor()
    const on = await run(env, ['shared-reach', SERVER_URL, 'watch'], { door })
    assert.equal(on.code, 0)
    assert.deepEqual(agent.asked.map(call => [call.fn, call.args]), [['sendMachineLineLink', [SERVER_URL]]])
    assert.deepEqual(asked.find(call => call.args[1] === 'add'), { args: ['line', 'add', '-', 'watch'], input: LINK })
    assert.deepEqual((on.out as { shared: SharedStatus[] }).shared[0], { url: SERVER_URL, reach: 'watch', line: 'l1abcd', claude: { there: false, working: false } })

    const full = await run(env, ['shared-reach', SERVER_URL, 'full'], { door })
    assert.equal((full.out as { shared: SharedStatus[] }).shared[0]!.reach, 'full')
    assert.equal(agent.asked.length, 1, 'a line that is there is not asked for again')

    const off = await run(env, ['shared-reach', SERVER_URL, 'off'], { door })
    assert.equal((off.out as { shared: SharedStatus[] }).shared[0]!.reach, undefined)
    assert.deepEqual(asked.at(-2)?.args, ['line', 'remove', SERVER_URL])
  } finally {
    await agent.close()
    await home.remove()
  }
})

test('a login copied here from the person\'s own OpenAgent on a server says that server and keeps a mark of itself; one made here says none, and a name that is none is refused', async () => {
  const home = await testHome()
  try {
    const env = { ...home.env, OPENAGENT_PERSON: 'rom' }
    const shell = pretendShell(script => (GH_GIVEN.test(script) ? { out: 'rom\n' } : undefined))
    const copied = await run(env, ['own', 'login', 'github', '--from', 'vps-1'], { exec: shell.exec, stdin: async () => GH_LOGIN })
    const github = (copied.out as OwnStatus).logins.github
    assert.equal(github.from, 'vps-1')
    assert.equal(github.mark, markOf(GH_LOGIN))
    assert.equal(github.mark!.length, 16)
    const claude = await run(env, ['own', 'login', 'claude', '--from', 'vps-1'], { exec: shell.exec, stdin: async () => CLAUDE_LOGIN })
    assert.deepEqual([(claude.out as OwnStatus).logins.claude.from, (claude.out as OwnStatus).logins.claude.mark], ['vps-1', markOf(CLAUDE_LOGIN)])
    // Made here, by the person: no server, and the mark of what was handed over.
    const made = await run(env, ['own', 'login', 'claude'], { exec: shell.exec, stdin: async () => CLAUDE_LOGIN })
    assert.equal((made.out as OwnStatus).logins.claude.from, undefined)
    assert.equal((made.out as OwnStatus).logins.claude.mark, markOf(CLAUDE_LOGIN))
    assert.equal((await readFile(storePath(env), 'utf8')).includes(CLAUDE_LOGIN), false)
    assert.equal((await run(env, ['own', 'login', 'github', '--from', 'not a name'], { exec: shell.exec, stdin: async () => GH_LOGIN })).code, 2)
    assert.equal((await run(env, ['own', 'login', 'github', '--to', 'vps-1'], { exec: shell.exec, stdin: async () => GH_LOGIN })).code, 2)
  } finally {
    await home.remove()
  }
})

const BOX_URL = `${SERVER_URL}/_devices/via/b0x1d2`

test('for another person\'s computer, the logins there are read through OpenAgent, and one made here is handed over through it as no copy', async () => {
  const home = await testHome()
  let logins: unknown = { github: { source: 'copied', from: 'vps-1', account: 'rom' } }
  const agent = await openAgent(fn => (fn === 'onMachineLogins' ? { ok: true, logins } : fn === 'sendMachineLogins' ? ((logins = { github: { source: 'made', account: 'rom' } }), { ok: true, logins }) : undefined))
  try {
    const env = { ...home.env, OPENAGENT_URL: agent.url }
    const read = await run(env, ['other', BOX_URL])
    assert.deepEqual(read.out, { other: [{ url: BOX_URL, logins: { github: { source: 'copied', from: 'vps-1', account: 'rom' } }, claude: { there: false, working: false } }] } satisfies { other: OtherStatus[] })
    const gh: Exec = async bin => (bin === 'gh' ? { code: 0, out: `${GH_LOGIN}\n`, err: '' } : { code: 1, out: '', err: '' })
    const given = await run(env, ['other-login', BOX_URL, 'github'], { exec: gh })
    assert.equal(given.code, 0)
    assert.deepEqual(agent.asked.find(call => call.fn === 'sendMachineLogins')?.args, [BOX_URL, { github: GH_LOGIN }])
    assert.deepEqual((given.out as { other: OtherStatus[] }).other[0]!.logins, { github: { source: 'made', account: 'rom' } })

    // A Claude login is made by a process of its own, and goes the same way.
    const started: string[][] = []
    await run(env, ['other-login', BOX_URL, 'claude'], { startWork: words => (started.push(words), 4242) })
    assert.deepEqual(started, [['other-work', BOX_URL]])
    assert.equal((await run(env, ['other-work', BOX_URL], { mint: async () => ({ ok: true, login: CLAUDE_LOGIN }) })).code, 0)
    assert.deepEqual(agent.asked.at(-1), { fn: 'sendMachineLogins', args: [BOX_URL, { claude: CLAUDE_LOGIN }], origin: agent.url })
    assert.equal((await readFile(storePath(env), 'utf8')).includes(CLAUDE_LOGIN), false)

    // What names no computer of another person's is not one.
    assert.equal((await run(env, ['other', SERVER_URL])).code, 2)
    assert.equal((await run(env, ['other', `${SERVER_URL}/_devices/via/../x`])).code, 2)
  } finally {
    await agent.close()
    await home.remove()
  }
})
