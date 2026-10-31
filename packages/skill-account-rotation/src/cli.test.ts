import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runAdding, type AddingNow } from './adding.js'
import { accountsPath, addAccount, markLimited, nameOwnAccount, readAccounts } from './accounts.js'
import { runCli } from './cli.js'
import { loginWiring, type LoginWiring } from './login.js'

interface Run {
  code: number
  out: string[]
  err: string[]
}

async function inDir(body: (env: NodeJS.ProcessEnv, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'account-rotation-cli-'))
  try {
    await body({ HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') }, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Run a command, with a sign-in `add` starts running here in place of a process of its own, and ended before this answers. */
async function run(argv: string[], env: NodeJS.ProcessEnv, more: Partial<LoginWiring> = {}, stdin?: string): Promise<Run> {
  const out: string[] = []
  const err: string[] = []
  const signIns: Promise<void>[] = []
  const wiring: LoginWiring = { ...loginWiring(env), isRunning: () => true, ...more }
  wiring.startAdding = (agent, name) => void signIns.push(runAdding(agent, name, wiring))
  const code = await runCli(argv, { stdout: line => out.push(line), stderr: line => err.push(line), env, wiring, ...(stdin !== undefined ? { stdin: () => Promise.resolve(stdin) } : {}) })
  await Promise.all(signIns)
  return { code, out, err }
}

const adding = async (env: NodeJS.ProcessEnv, agent: 'claude' | 'codex' = 'claude'): Promise<AddingNow> => (JSON.parse((await run(['adding'], env)).out[0]!) as Record<string, AddingNow>)[agent]!

const names = (answer: Run, agent?: 'claude' | 'codex'): string[] => {
  const said = JSON.parse(answer.out[0]!) as { name: string }[] | Record<string, { name: string }[]>
  return (agent ? (said as Record<string, { name: string }[]>)[agent]! : (said as { name: string }[])).map(a => a.name)
}

test('list answers each agent\'s accounts in the order runs try them, how full and whether limited, and never a login', () =>
  inDir(async env => {
    addAccount('Dani', 'sk-ant-oat01-secret', accountsPath('claude', env))
    markLimited('Dani', Date.now() + 60_000, Date.now(), accountsPath('claude', env))
    const listed = await run(['list'], env)
    assert.equal(listed.code, 0)
    assert.deepEqual(names(listed, 'claude'), ['This computer', 'Dani'])
    assert.deepEqual(names(listed, 'codex'), ['This computer'])
    assert.ok(!listed.out[0]!.includes('sk-ant-oat01-secret'))
    const { claude } = JSON.parse(listed.out[0]!) as { claude: { own: boolean; limitedUntil?: number }[] }
    assert.equal(claude[0]!.own, true)
    assert.equal(claude[1]!.own, false)
    assert.equal(typeof claude[1]!.limitedUntil, 'number')
  }))

test('add signs in by itself, keeps the login under the name, and nothing says the login', () =>
  inDir(async env => {
    const mint: LoginWiring['mint'] = () => Promise.resolve({ ok: true, login: 'sk-ant-oat01-new' })
    const added = await run(['add', 'claude', ' Dani '], env, { mint })
    assert.equal(added.code, 0)
    assert.deepEqual(names(await run(['list'], env), 'claude'), ['This computer', 'Dani'])
    assert.equal(readAccounts(accountsPath('claude', env)).find(a => a.name === 'Dani')?.login, 'sk-ant-oat01-new')
    assert.ok(![...added.out, ...added.err].join('\n').includes('sk-ant-oat01-new'))
    assert.ok((await stat(accountsPath('claude', env))).mode % 0o1000 === 0o600)
    assert.deepEqual(await adding(env), {})
  }))

test('add refuses a name that is taken before any browser opens, and adding says why a sign-in did not go through until the next add', () =>
  inDir(async env => {
    let minted = 0
    const mint: LoginWiring['mint'] = () => {
      minted++
      return Promise.resolve({ ok: false, error: 'Nobody signed in in time.' })
    }
    addAccount('Dani', 'x', accountsPath('claude', env))
    const taken = await run(['add', 'claude', 'dani'], env, { mint })
    assert.equal(taken.code, 1)
    assert.match(taken.err.join('\n'), /already/)
    assert.equal(minted, 0)
    assert.equal((await run(['add', 'claude', 'Rom'], env, { mint })).code, 0)
    assert.deepEqual(await adding(env), { failed: 'Nobody signed in in time.' })
    assert.deepEqual(readAccounts(accountsPath('claude', env)).map(a => a.name), ['This computer', 'Dani'])
    await run(['add', 'claude', 'Rom'], env, { mint: () => Promise.resolve({ ok: true, login: 'y' }) })
    assert.deepEqual(await adding(env), {})
  }))

test('add refuses the name the person\'s own login goes by, before they named it', () =>
  inDir(async (env, dir) => {
    const claudeJson = join(dir, '.claude.json')
    await writeFile(claudeJson, JSON.stringify({ oauthAccount: { displayName: 'Suleiman' } }))
    const taken = await run(['add', 'claude', 'suleiman'], env, { claudeJson: () => claudeJson })
    assert.equal(taken.code, 1)
    assert.match(taken.err.join('\n'), /already/)
  }))

test('adding a Codex account says the page to copy into a private window, and an account on the list already is refused, leaving no folder', () =>
  inDir(async env => {
    const wiring = loginWiring(env)
    const folder = join(wiring.codexDir(), 'codex-new')
    let during: AddingNow | undefined
    const loginCodex: LoginWiring['loginCodex'] = async opts => {
      opts.onUrl?.('https://auth.example/sign-in')
      during = (await adding(env, 'codex'))
      await mkdir(folder, { recursive: true })
      return { ok: true, login: 'codex-new', who: { key: 'same/ws' } }
    }
    assert.equal((await run(['add', 'codex', 'Dani'], env, { loginCodex, codexWho: () => Promise.resolve({ key: 'other/ws' }) })).code, 0)
    assert.deepEqual(during, { adding: { name: 'Dani', url: 'https://auth.example/sign-in' } })
    await run(['add', 'codex', 'Rom'], env, { loginCodex, codexWho: () => Promise.resolve({ key: 'same/ws' }) })
    assert.match((await adding(env, 'codex')).failed ?? '', /on the list already/)
    await assert.rejects(stat(folder))
    assert.deepEqual(readAccounts(accountsPath('codex', env)).map(a => a.name), ['This computer', 'Dani'])
  }))

test('remove takes an added account off, a Codex one with its folder; the person\'s own and a name not there are refused', () =>
  inDir(async env => {
    const wiring = loginWiring(env)
    addAccount('Dani', 'codex-dani', accountsPath('codex', env))
    const folder = join(wiring.codexDir(), 'codex-dani')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'auth.json'), '{}')
    const own = await run(['remove', 'codex', 'This computer'], env)
    assert.equal(own.code, 1)
    const nobody = await run(['remove', 'codex', 'Nobody'], env)
    assert.equal(nobody.code, 1)
    assert.match(nobody.err.join('\n'), /no added codex account named Nobody/)
    assert.deepEqual(readAccounts(accountsPath('codex', env)).map(a => a.name), ['This computer', 'Dani'])
    const removed = await run(['remove', 'codex', 'Dani'], env)
    assert.equal(removed.code, 0)
    assert.deepEqual(names(removed), ['This computer'])
    await assert.rejects(stat(folder))
  }))

test('list says who the own login is while it goes by no given name, and use-first still takes its name', () =>
  inDir(async env => {
    await mkdir(env['HOME']!, { recursive: true })
    await writeFile(join(env['HOME']!, '.claude.json'), JSON.stringify({ oauthAccount: { displayName: 'Ada' } }))
    addAccount('Dani', 'sk-ant-oat01-secret', accountsPath('claude', env))
    const said = JSON.parse((await run(['list'], env)).out[0]!) as Record<string, { name: string; who?: string }[]>
    assert.deepEqual(said['claude']!.map(a => [a.name, a.who]), [['This computer', 'Ada'], ['Dani', undefined]])
    assert.equal(said['codex']![0]!.who, undefined)
    assert.equal((said['codex']![0] as { signedOut?: true }).signedOut, true)
    assert.equal((await run(['use-first', 'claude', 'This computer'], env)).code, 0)
    nameOwnAccount('Me', accountsPath('claude', env))
    const named = JSON.parse((await run(['list'], env)).out[0]!) as Record<string, { name: string; who?: string }[]>
    assert.equal(named['claude']![0]!.name, 'Me')
    assert.equal(named['claude']![0]!.who, undefined)
    assert.equal((named['claude']![0] as { computer?: string }).computer, hostname().replace(/\.local$/i, ''))
  }))

test('use-first moves the account to the front; a name not there is refused, and the list stays', () =>
  inDir(async env => {
    addAccount('Dani', 'x', accountsPath('claude', env))
    const moved = await run(['use-first', 'claude', 'Dani'], env)
    assert.equal(moved.code, 0)
    assert.deepEqual(names(moved), ['Dani', 'This computer'])
    const nobody = await run(['use-first', 'claude', 'Nobody'], env)
    assert.equal(nobody.code, 1)
    assert.match(nobody.err.join('\n'), /no claude account named Nobody/)
    assert.deepEqual(readAccounts(accountsPath('claude', env)).map(a => a.name), ['Dani', 'This computer'])
  }))

test('on a server remove is refused and says where it is done; list and use-first still work', () =>
  inDir(async env => {
    const server = { ...env, OPENAGENT_SERVER: '1' }
    addAccount('Dani', 'x', accountsPath('claude', server))
    const refused = await run(['remove', 'claude', 'Dani'], server)
    assert.equal(refused.code, 1)
    assert.match(refused.err.join('\n'), /Settings › Accounts/)
    assert.deepEqual(readAccounts(accountsPath('claude', server)).map(a => a.name), ['This computer', 'Dani'])
    assert.equal((await run(['list'], server)).code, 0)
    assert.equal((await run(['use-first', 'claude', 'Dani'], server)).code, 0)
  }))

test('on a server adding a Claude account says the page to open, and the code brought back on standard input goes to Claude Code', () =>
  inDir(async env => {
    const server = { ...env, OPENAGENT_SERVER: '1' }
    const pasted: string[] = []
    let during: AddingNow | undefined
    let refusedCode: Run | undefined
    let goodCode: Run | undefined
    const mint: LoginWiring['mint'] = ({ onLink } = {}) =>
      new Promise(resolve => {
        onLink!('https://claude.example/sign-in', code => {
          pasted.push(code)
          resolve({ ok: true, login: 'sk-ant-oat01-new' })
          return true
        })
        void (async () => {
          during = await adding(server)
          refusedCode = await run(['add-code', 'claude'], server, {}, 'not a code!')
          goodCode = await run(['add-code', 'claude'], server, {}, ' the-code-here\n')
        })()
      })
    assert.equal((await run(['add-code', 'claude'], server, {}, 'the-code-here')).code, 1)
    assert.equal((await run(['add', 'claude', 'Dani'], server, { mint })).code, 0)
    assert.deepEqual(during, { adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true } })
    assert.match(refusedCode!.err.join('\n'), /not the code the page shows/)
    assert.equal(goodCode!.code, 0)
    assert.deepEqual(pasted, ['the-code-here'])
    assert.deepEqual(names(await run(['list'], server), 'claude'), ['This computer', 'Dani'])
    assert.match((await run(['add-code', 'claude'], server, {}, 'too-late-code')).err.join('\n'), /No login waits/)
    await assert.rejects(stat(`${loginWiring(server).addingPath('claude')}.code`))
  }))

test('on a server a code is said to be with Claude while it checks it, and to be refused when it does not take it, ready for another', () =>
  inDir(async env => {
    const server = { ...env, OPENAGENT_SERVER: '1' }
    const said: (AddingNow | undefined)[] = []
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
    const mint: LoginWiring['mint'] = ({ onLink, onRefused } = {}) =>
      new Promise(resolve => {
        let codes = 0
        onLink!('https://claude.example/sign-in', () => {
          codes += 1
          if (codes === 1) setTimeout(() => void wait(400).then(() => onRefused!()), 0)
          else resolve({ ok: true, login: 'sk-ant-oat01-new' })
          return true
        })
        void (async () => {
          await run(['add-code', 'claude'], server, {}, 'first-code-here')
          await wait(300)
          said.push(await adding(server))
          await wait(500)
          said.push(await adding(server))
          await run(['add-code', 'claude'], server, {}, 'second-code-here')
        })()
      })
    await run(['add', 'claude', 'Dani'], server, { mint })
    assert.deepEqual(said, [
      { adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true, checking: true } },
      { adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true, refused: true } },
    ])
    assert.deepEqual(names(await run(['list'], server), 'claude'), ['This computer', 'Dani'])
  }))

test('on a server adding a Codex account says the code to type and where', () =>
  inDir(async env => {
    const server = { ...env, OPENAGENT_SERVER: '1' }
    let during: AddingNow | undefined
    const loginCodex: LoginWiring['loginCodex'] = async opts => {
      opts.onCode?.('ABCD-1234', 'https://auth.example/device')
      during = await adding(server, 'codex')
      return { ok: false, error: 'stopped' }
    }
    await run(['add', 'codex', 'Dani'], server, { loginCodex })
    assert.deepEqual(during, { adding: { name: 'Dani', url: 'https://auth.example/device', code: 'ABCD-1234' } })
  }))

test('one sign-in at a time for an agent, and a sign-in whose process is gone is no longer under way', () =>
  inDir(async env => {
    let release!: () => void
    const mint: LoginWiring['mint'] = () => new Promise(resolve => (release = () => resolve({ ok: true, login: 'y' })))
    const wiring: LoginWiring = { ...loginWiring(env), isRunning: () => true, mint, startAdding: (agent, name) => void runAdding(agent, name, wiring) }
    const say = (argv: string[], use: LoginWiring = wiring): Promise<Run> => run(argv, env, use)
    const first: string[] = []
    assert.equal(await runCli(['add', 'claude', 'Dani'], { stdout: line => first.push(line), stderr: () => {}, env, wiring }), 0)
    assert.deepEqual(JSON.parse(first[0]!), { adding: { name: 'Dani' } })
    const second: string[] = []
    assert.equal(await runCli(['add', 'claude', 'Rom'], { stdout: () => {}, stderr: line => second.push(line), env, wiring }), 1)
    assert.match(second.join('\n'), /Dani's account is being added/)
    assert.deepEqual((JSON.parse((await say(['adding'], { ...wiring, isRunning: () => false })).out[0]!) as Record<string, AddingNow>)['claude'], {})
    release()
  }))

test('add-cancel stops the sign-in under way and forgets it, keeping nothing', () =>
  inDir(async env => {
    const stop = new AbortController()
    let stopped: number | undefined
    const mint: LoginWiring['mint'] = ({ signal } = {}) => new Promise(resolve => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'The login was stopped.' })))
    let signIn: Promise<void> | undefined
    const wiring: LoginWiring = {
      ...loginWiring(env),
      isRunning: () => true,
      mint,
      startAdding: (agent, name) => void (signIn = runAdding(agent, name, wiring, stop.signal)),
      stopAdding: pid => {
        stopped = pid
        stop.abort()
      },
    }
    const io = { stdout: () => {}, stderr: () => {}, env, wiring }
    assert.equal(await runCli(['add', 'claude', 'Dani'], io), 0)
    assert.equal(await runCli(['add-cancel', 'claude'], io), 0)
    assert.equal(stopped, process.pid)
    await signIn
    assert.deepEqual(await adding(env), {})
    assert.deepEqual(readAccounts(accountsPath('claude', env)).map(a => a.name), ['This computer'])
  }))

test('a command that cannot be read says the usage and exits 2', () =>
  inDir(async env => {
    for (const argv of [[], ['nope'], ['list', 'claude'], ['add'], ['add', 'claude'], ['add', 'gemini', 'Rom'], ['add', 'claude', 'Rom', 'extra'], ['adding', 'claude'], ['add-code'], ['add-cancel', 'gemini']]) {
      const wrong = await run(argv, env)
      assert.equal(wrong.code, 2, argv.join(' '))
      assert.match(wrong.err.join('\n'), /usage: account-rotation/)
    }
    assert.deepEqual(await readFile(accountsPath('claude', env), 'utf8').catch(() => 'no file'), 'no file')
  }))
