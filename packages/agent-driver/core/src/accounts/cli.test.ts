import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AgentAccount, AgentLogins, SignInSaid } from '@openagt/hooks'
import { runAdding, type AddingNow } from './adding.js'
import { accountsPath, addAccount, markLimited, nameOwnAccount, readAccounts } from './accounts.js'
import { runCli, USAGE } from './cli.js'
import { testLogins } from './test-logins.js'
import { loginWiring, type LoginWiring } from './wiring.js'

// The command, on coding agents of a test's own (`test-logins.ts`): what each agent does with its
// logins is its adapter's, tested there.

interface Run {
  code: number
  out: string[]
  err: string[]
}

async function inDir(body: (env: NodeJS.ProcessEnv, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'account-rotation-cli-'))
  try {
    // A computer with a screen: a browser opens on it.
    await body({ HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state'), DISPLAY: ':0' }, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The agents of a test: a `claude` and a `codex` list, each as `more` says. */
const agents = (claude: Partial<AgentLogins> = {}, codex: Partial<AgentLogins> = {}): Pick<LoginWiring, 'logins'> => ({
  logins: () => Promise.resolve([testLogins('claude', claude), testLogins('codex', codex)]),
})

/** Run a command, with a sign-in `add` starts running here in place of a process of its own, and ended before this answers. */
async function run(argv: string[], env: NodeJS.ProcessEnv, more: Partial<LoginWiring> = {}, stdin?: string): Promise<Run> {
  const out: string[] = []
  const err: string[] = []
  const signIns: Promise<void>[] = []
  const wiring: LoginWiring = { ...loginWiring(env), ...agents(), isRunning: () => true, ...more }
  wiring.startAdding = (list, name) => void signIns.push(wiring.logins().then(all => runAdding(all.find(one => one.list === list)!, name, wiring)))
  const code = await runCli(argv, { stdout: line => out.push(line), stderr: line => err.push(line), env, wiring, ...(stdin !== undefined ? { stdin: () => Promise.resolve(stdin) } : {}) })
  await Promise.all(signIns)
  return { code, out, err }
}

const adding = async (env: NodeJS.ProcessEnv, list: 'claude' | 'codex' = 'claude', more: Partial<LoginWiring> = {}): Promise<AddingNow> => (JSON.parse((await run(['adding'], env, more)).out[0]!) as Record<string, AddingNow>)[list]!

/** A computer with no browser: the person signs in on another device. */
const noBrowser: Partial<LoginWiring> = { headless: () => true }

const names = (answer: Run, list?: 'claude' | 'codex'): string[] => {
  const said = JSON.parse(answer.out[0]!) as { name: string }[] | Record<string, { name: string }[]>
  return (list ? (said as Record<string, { name: string }[]>)[list]! : (said as { name: string }[])).map(a => a.name)
}

test("list answers each list's accounts in the order runs try them, how full and whether limited, and never a login", () =>
  inDir(async env => {
    addAccount('Dani', 'sk-ant-oat01-secret', accountsPath('claude', env))
    markLimited('Dani', Date.now() + 60_000, Date.now(), accountsPath('claude', env))
    const listed = await run(['list'], env)
    assert.equal(listed.code, 0)
    assert.deepEqual(Object.keys(JSON.parse(listed.out[0]!) as object), ['claude', 'codex', 'notInstalled'])
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
    const added = await run(['add', 'claude', ' Dani '], env, agents({ signIn: () => Promise.resolve({ ok: true, login: 'sk-ant-oat01-new' }) }))
    assert.equal(added.code, 0)
    assert.deepEqual(names(await run(['list'], env), 'claude'), ['This computer', 'Dani'])
    assert.equal(readAccounts(accountsPath('claude', env)).find(a => a.name === 'Dani')?.login, 'sk-ant-oat01-new')
    assert.ok(![...added.out, ...added.err].join('\n').includes('sk-ant-oat01-new'))
    assert.ok((await stat(accountsPath('claude', env))).mode % 0o1000 === 0o600)
    assert.deepEqual(await adding(env), {})
  }))

test('the agent signs in with the accounts on the list, to tell one of them apart; one the list cannot take after all is forgotten by the agent', () =>
  inDir(async env => {
    addAccount('Dani', 'codex-dani', accountsPath('codex', env))
    let known: string[] = []
    const forgotten: AgentAccount[] = []
    const codex: Partial<AgentLogins> = {
      signIn: accounts => {
        known = accounts.map(a => a.name)
        // Another sign-in took the name while this one went.
        addAccount('Rom', 'codex-other', accountsPath('codex', env))
        return Promise.resolve({ ok: true, login: 'codex-rom' })
      },
      forget: account => (forgotten.push(account), Promise.resolve()),
    }
    await run(['add', 'codex', 'Rom'], env, agents({}, codex))
    assert.deepEqual(known, ['This computer', 'Dani'])
    assert.match((await adding(env, 'codex')).failed ?? '', /There is an account named Rom already/)
    assert.deepEqual(forgotten, [{ name: 'Rom', login: 'codex-rom' }])
  }))

test('add refuses a name that is taken before any browser opens, and adding says why a sign-in did not go through until the next add', () =>
  inDir(async env => {
    let signedIn = 0
    const failing = agents({
      signIn: () => {
        signedIn++
        return Promise.resolve({ ok: false, error: 'Nobody signed in in time.' })
      },
    })
    addAccount('Dani', 'x', accountsPath('claude', env))
    const taken = await run(['add', 'claude', 'dani'], env, failing)
    assert.equal(taken.code, 1)
    assert.match(taken.err.join('\n'), /already/)
    assert.equal(signedIn, 0)
    assert.equal((await run(['add', 'claude', 'Rom'], env, failing)).code, 0)
    assert.deepEqual(await adding(env), { failed: 'Nobody signed in in time.' })
    assert.deepEqual(readAccounts(accountsPath('claude', env)).map(a => a.name), ['This computer', 'Dani'])
    await run(['add', 'claude', 'Rom'], env, agents({ signIn: () => Promise.resolve({ ok: true, login: 'y' }) }))
    assert.deepEqual(await adding(env), {})
  }))

test("add refuses the name the person's own login goes by, before they named it", () =>
  inDir(async env => {
    const taken = await run(['add', 'claude', 'suleiman'], env, agents({ ownName: () => Promise.resolve('Suleiman') }))
    assert.equal(taken.code, 1)
    assert.match(taken.err.join('\n'), /already/)
  }))

test("adding on this computer's browser says the page to copy into a private window while it goes, and why the agent did not take the account", () =>
  inDir(async env => {
    let said: SignInSaid | undefined
    let during: AddingNow | undefined
    const codex: Partial<AgentLogins> = {
      signIn: async (_accounts, given) => {
        said = given
        given.onUrl?.('https://auth.example/sign-in')
        during = await adding(env, 'codex')
        return { ok: false, error: 'That account is on the list already.' }
      },
    }
    await run(['add', 'codex', 'Dani'], env, agents({}, codex))
    assert.deepEqual(Object.keys(said!).sort(), ['onUrl'], "a browser here: no page to bring a code back from, no code to type")
    assert.deepEqual(during, { adding: { name: 'Dani', url: 'https://auth.example/sign-in' } })
    assert.deepEqual(await adding(env, 'codex'), { failed: 'That account is on the list already.' })
  }))

test('list names the lists whose agent is not installed, and only those', () =>
  inDir(async env => {
    const said = (installed: string[]) =>
      run(['list'], env, agents({ installed: () => Promise.resolve(installed.includes('claude')) }, { installed: () => Promise.resolve(installed.includes('codex')) })).then(answer => (JSON.parse(answer.out[0]!) as { notInstalled: string[] }).notInstalled)
    assert.deepEqual(await said(['claude']), ['codex'])
    assert.deepEqual(await said([]), ['claude', 'codex'])
    assert.deepEqual(await said(['claude', 'codex']), [])
  }))

test('adding says a computer has no browser on Linux with no display', () =>
  inDir(async env => {
    assert.deepEqual(await adding(env), {})
    const { DISPLAY: _, ...noScreen } = env
    assert.deepEqual(await adding(noScreen), process.platform === 'linux' ? { noBrowser: true } : {})
    assert.deepEqual(await adding({ ...noScreen, WAYLAND_DISPLAY: 'wayland-0' }), {})
  }))

test("remove takes an added account off, and the agent forgets what it kept of it; the person's own and a name not there are refused", () =>
  inDir(async env => {
    addAccount('Dani', 'codex-dani', accountsPath('codex', env))
    const forgotten: AgentAccount[] = []
    const codex = agents({}, { forget: account => (forgotten.push(account), Promise.resolve()) })
    const own = await run(['remove', 'codex', 'This computer'], env, codex)
    assert.equal(own.code, 1)
    const nobody = await run(['remove', 'codex', 'Nobody'], env, codex)
    assert.equal(nobody.code, 1)
    assert.match(nobody.err.join('\n'), /no added codex account named Nobody/)
    assert.deepEqual(readAccounts(accountsPath('codex', env)).map(a => a.name), ['This computer', 'Dani'])
    assert.equal(forgotten.length, 0)
    const removed = await run(['remove', 'codex', 'Dani'], env, codex)
    assert.equal(removed.code, 0)
    assert.deepEqual(names(removed), ['This computer'])
    assert.deepEqual(forgotten.map(a => [a.name, a.login]), [['Dani', 'codex-dani']])
  }))

test('list says who the own login is while it goes by no given name, and use-first still takes its name', () =>
  inDir(async env => {
    addAccount('Dani', 'sk-ant-oat01-secret', accountsPath('claude', env))
    const who = agents({ ownName: () => Promise.resolve('Ada') }, { ownLoginThere: () => false })
    const said = JSON.parse((await run(['list'], env, who)).out[0]!) as Record<string, { name: string; who?: string; signedOut?: true }[]>
    assert.deepEqual(said['claude']!.map(a => [a.name, a.who]), [['This computer', 'Ada'], ['Dani', undefined]])
    assert.equal(said['claude']![0]!.signedOut, undefined)
    assert.equal(said['codex']![0]!.who, undefined)
    assert.equal(said['codex']![0]!.signedOut, true)
    assert.equal((await run(['use-first', 'claude', 'This computer'], env, who)).code, 0)
    nameOwnAccount('Me', accountsPath('claude', env))
    const named = JSON.parse((await run(['list'], env, who)).out[0]!) as Record<string, { name: string; who?: string; computer?: string }[]>
    assert.equal(named['claude']![0]!.name, 'Me')
    assert.equal(named['claude']![0]!.who, undefined)
    assert.equal(named['claude']![0]!.computer, hostname().replace(/\.local$/i, ''))
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

test("logout runs the agent's own logout, of the person's own login, in the user's environment, and answers its list with the row out", () =>
  inDir(async env => {
    let there = true
    const loggedOut: NodeJS.ProcessEnv[] = []
    const codex = agents({}, { ownLoginThere: () => there, logOut: given => (loggedOut.push(given), (there = false), Promise.resolve()) })
    assert.equal((JSON.parse((await run(['list'], env, codex)).out[0]!) as Record<string, { signedOut?: true }[]>)['codex']![0]!.signedOut, undefined)
    const out = await run(['logout', 'codex'], env, codex)
    assert.equal(out.code, 0)
    assert.equal((JSON.parse(out.out[0]!) as { signedOut?: true }[])[0]!.signedOut, true)
    assert.deepEqual(loggedOut, [env])
  }))

test("logout says why not: a login from the environment is not the agent's to end, and a logout that fails is said", () =>
  inDir(async env => {
    const given = await run(['logout', 'claude'], { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'x' }, agents({ envLogins: ['CLAUDE_CODE_OAUTH_TOKEN'], logOut: () => assert.fail('no logout for a login from the environment') }))
    assert.equal(given.code, 1)
    assert.match(given.err.join('\n'), /CLAUDE_CODE_OAUTH_TOKEN in the environment/)
    const broke = await run(['logout', 'codex'], env, agents({}, { logOut: () => Promise.reject(new Error('no codex here')) }))
    assert.equal(broke.code, 1)
    assert.match(broke.err.join('\n'), /did not go through: no codex here/)
  }))

test('with no browser here, adding says the page to open, and the code brought back on standard input goes to the agent', () =>
  inDir(async env => {
    const pasted: string[] = []
    let said: SignInSaid | undefined
    let during: AddingNow | undefined
    let refusedCode: Run | undefined
    let goodCode: Run | undefined
    const claude = agents({
      signIn: (_accounts, given) =>
        new Promise(resolve => {
          said = given
          given.onLink!('https://claude.example/sign-in', code => {
            pasted.push(code)
            resolve({ ok: true, login: 'sk-ant-oat01-new' })
            return true
          })
          void (async () => {
            during = await adding(env, 'claude', noBrowser)
            refusedCode = await run(['add-code', 'claude'], env, noBrowser, 'not a code!')
            goodCode = await run(['add-code', 'claude'], env, noBrowser, ' the-code-here\n')
          })()
        }),
    })
    assert.equal((await run(['add-code', 'claude'], env, noBrowser, 'the-code-here')).code, 1)
    assert.equal((await run(['add', 'claude', 'Dani'], env, { ...claude, ...noBrowser })).code, 0)
    assert.deepEqual(Object.keys(said!).sort(), ['onCode', 'onLink', 'onRefused'], 'no browser here: a page whose code comes back, or a code to type at one')
    assert.deepEqual(during, { noBrowser: true, adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true } })
    assert.match(refusedCode!.err.join('\n'), /not the code the page shows/)
    assert.equal(goodCode!.code, 0)
    assert.deepEqual(pasted, ['the-code-here'])
    assert.deepEqual(names(await run(['list'], env), 'claude'), ['This computer', 'Dani'])
    assert.match((await run(['add-code', 'claude'], env, noBrowser, 'too-late-code')).err.join('\n'), /No login waits/)
    await assert.rejects(stat(`${loginWiring(env).addingPath('claude')}.code`))
  }))

test('with no browser here, a code is said to be with the agent while it checks it, and to be refused when it does not take it, ready for another', () =>
  inDir(async env => {
    const said: (AddingNow | undefined)[] = []
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
    const claude = agents({
      signIn: (_accounts, { onLink, onRefused }) =>
        new Promise(resolve => {
          let codes = 0
          onLink!('https://claude.example/sign-in', () => {
            codes += 1
            if (codes === 1) setTimeout(() => void wait(400).then(() => onRefused!()), 0)
            else resolve({ ok: true, login: 'sk-ant-oat01-new' })
            return true
          })
          void (async () => {
            await run(['add-code', 'claude'], env, noBrowser, 'first-code-here')
            await wait(300)
            said.push(await adding(env, 'claude', noBrowser))
            await wait(500)
            said.push(await adding(env, 'claude', noBrowser))
            await run(['add-code', 'claude'], env, noBrowser, 'second-code-here')
          })()
        }),
    })
    await run(['add', 'claude', 'Dani'], env, { ...claude, ...noBrowser })
    assert.deepEqual(said, [
      { noBrowser: true, adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true, checking: true } },
      { noBrowser: true, adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true, refused: true } },
    ])
    assert.deepEqual(names(await run(['list'], env), 'claude'), ['This computer', 'Dani'])
  }))

test('with no browser here, adding says the code to type and where', () =>
  inDir(async env => {
    let during: AddingNow | undefined
    const codex = agents(
      {},
      {
        signIn: async (_accounts, { onCode }) => {
          onCode?.('ABCD-1234', 'https://auth.example/device')
          during = await adding(env, 'codex', noBrowser)
          return { ok: false, error: 'stopped' }
        },
      },
    )
    await run(['add', 'codex', 'Dani'], env, { ...codex, ...noBrowser })
    assert.deepEqual(during, { noBrowser: true, adding: { name: 'Dani', url: 'https://auth.example/device', code: 'ABCD-1234' } })
  }))

test('one sign-in at a time for a list, and a sign-in whose process is gone is no longer under way', () =>
  inDir(async env => {
    let release!: () => void
    const claude = testLogins('claude', { signIn: () => new Promise(resolve => (release = () => resolve({ ok: true, login: 'y' }))) })
    const wiring: LoginWiring = { ...loginWiring(env), logins: () => Promise.resolve([claude]), isRunning: () => true, startAdding: (_list, name) => void runAdding(claude, name, wiring) }
    const first: string[] = []
    assert.equal(await runCli(['add', 'claude', 'Dani'], { stdout: line => first.push(line), stderr: () => {}, env, wiring }), 0)
    assert.deepEqual(JSON.parse(first[0]!), { adding: { name: 'Dani' } })
    const second: string[] = []
    assert.equal(await runCli(['add', 'claude', 'Rom'], { stdout: () => {}, stderr: line => second.push(line), env, wiring }), 1)
    assert.match(second.join('\n'), /Dani's account is being added/)
    assert.deepEqual((JSON.parse((await run(['adding'], env, { ...wiring, isRunning: () => false })).out[0]!) as Record<string, AddingNow>)['claude'], {})
    release()
  }))

test('add-cancel stops the sign-in under way and forgets it, keeping nothing', () =>
  inDir(async env => {
    const stop = new AbortController()
    let stopped: number | undefined
    const claude = testLogins('claude', { signIn: (_accounts, { signal }) => new Promise(resolve => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'The login was stopped.' }))) })
    let signIn: Promise<void> | undefined
    const wiring: LoginWiring = {
      ...loginWiring(env),
      logins: () => Promise.resolve([claude]),
      isRunning: () => true,
      startAdding: (_list, name) => void (signIn = runAdding(claude, name, wiring, stop.signal)),
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

test('--help is the usage on stdout, exit 0', () =>
  inDir(async env => {
    for (const help of ['--help', '-h']) assert.deepEqual(await run([help], env), { code: 0, out: [USAGE], err: [] })
  }))

test('a command that cannot be read says what was wrong and where the usage is, and exits 2; no command at all, the usage; a list of no agent here is not read', () =>
  inDir(async env => {
    for (const argv of [[], ['nope'], ['list', 'claude'], ['add'], ['add', 'claude'], ['add', 'gemini', 'Rom'], ['add', 'claude', 'Rom', 'extra'], ['adding', 'claude'], ['add-code'], ['add-cancel', 'gemini']]) {
      const wrong = await run(argv, env)
      assert.equal(wrong.code, 2, argv.join(' '))
      assert.match(wrong.err.join('\n'), argv.length ? /\nRun `account-rotation --help` for usage\.$/ : /^usage: account-rotation/)
    }
    assert.deepEqual((await run(['nope'], env)).err, ['unknown command: nope\nRun `account-rotation --help` for usage.'])
    assert.deepEqual((await run(['add', 'gemini', 'Rom'], env)).err, ['wrong arguments for add: gemini Rom\nRun `account-rotation --help` for usage.'])
    assert.deepEqual((await run(['add', 'codex', 'Rom'], env, { logins: () => Promise.resolve([testLogins('claude')]) })).code, 2, 'a distribution with no Codex has no codex list')
    assert.deepEqual(await readFile(accountsPath('claude', env), 'utf8').catch(() => 'no file'), 'no file')
  }))

test('a command with no coding agent handed down to it says so: there is no list to read or change', () =>
  inDir(async env => {
    for (const argv of [['list'], ['add', 'claude', 'Rom']]) {
      const none = await run(argv, env, { logins: () => Promise.resolve([]) })
      assert.equal(none.code, 1, argv.join(' '))
      assert.match(none.err.join('\n'), /No coding agent was handed down to this process/)
    }
    assert.equal((await run(['--help'], env, { logins: () => Promise.resolve([]) })).code, 0)
  }))

test("an added account whose login is gone is listed signed out; add under its name signs in to it again, in its place, and what the agent kept of the old login goes; runs skip it meanwhile", () =>
  inDir(async env => {
    addAccount('Dani', 'old-login', accountsPath('claude', env))
    addAccount('Rom', 'rom-login', accountsPath('claude', env))
    const there = new Set(['rom-login'])
    const forgotten: string[] = []
    const claude: Partial<AgentLogins> = {
      addedLoginThere: account => there.has(account.login ?? ''),
      signIn: accounts => {
        // Signed in to again, the account is not among the ones it is told apart from.
        assert.deepEqual(accounts.map(a => a.name), ['This computer', 'Rom'])
        there.add('new-login')
        return Promise.resolve({ ok: true, login: 'new-login' })
      },
      forget: account => (forgotten.push(account.login ?? ''), Promise.resolve()),
    }
    const listed = JSON.parse((await run(['list'], env, agents(claude))).out[0]!) as Record<string, { name: string; signedOut?: true }[]>
    assert.deepEqual(listed['claude']!.map(a => [a.name, a.signedOut === true]), [['This computer', false], ['Dani', true], ['Rom', false]])
    const again = await run(['add', 'claude', 'dani'], env, agents(claude))
    assert.equal(again.code, 0)
    assert.deepEqual(readAccounts(accountsPath('claude', env)).map(a => [a.name, a.login]), [['This computer', undefined], ['Dani', 'new-login'], ['Rom', 'rom-login']])
    assert.deepEqual(forgotten, ['old-login'])
    // A name an account has, signed in, is still refused.
    assert.equal((await run(['add', 'claude', 'Rom'], env, agents(claude))).code, 1)
  }))
