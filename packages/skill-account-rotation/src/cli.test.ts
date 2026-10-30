import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { accountsPath, addAccount, markLimited, readAccounts } from './accounts.js'
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

async function run(argv: string[], env: NodeJS.ProcessEnv, wiring: Partial<LoginWiring> = {}): Promise<Run> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { stdout: line => out.push(line), stderr: line => err.push(line), env, wiring: { ...loginWiring(env), ...wiring } })
  return { code, out, err }
}

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

test('add signs in, keeps the login under the name, and answers the list; the login never reaches the output', () =>
  inDir(async env => {
    const mint: LoginWiring['mint'] = () => Promise.resolve({ ok: true, login: 'sk-ant-oat01-new' })
    const added = await run(['add', 'claude', ' Dani '], env, { mint })
    assert.equal(added.code, 0)
    assert.deepEqual(names(added), ['This computer', 'Dani'])
    assert.equal(readAccounts(accountsPath('claude', env)).find(a => a.name === 'Dani')?.login, 'sk-ant-oat01-new')
    assert.ok(![...added.out, ...added.err].join('\n').includes('sk-ant-oat01-new'))
    assert.ok((await stat(accountsPath('claude', env))).mode % 0o1000 === 0o600)
  }))

test('add refuses a name that is taken before any browser opens, and says why a sign-in did not go through', () =>
  inDir(async env => {
    let minted = 0
    const mint: LoginWiring['mint'] = () => {
      minted++
      return Promise.resolve({ ok: false, error: 'Nobody signed in.' })
    }
    addAccount('Dani', 'x', accountsPath('claude', env))
    const taken = await run(['add', 'claude', 'dani'], env, { mint })
    assert.equal(taken.code, 1)
    assert.match(taken.err.join('\n'), /already/)
    assert.equal(minted, 0)
    const failed = await run(['add', 'claude', 'Rom'], env, { mint })
    assert.equal(failed.code, 1)
    assert.match(failed.err.join('\n'), /Nobody signed in/)
    assert.deepEqual(failed.out, [])
    assert.deepEqual(readAccounts(accountsPath('claude', env)).map(a => a.name), ['This computer', 'Dani'])
  }))

test('add refuses the name the person\'s own login goes by, before they named it', () =>
  inDir(async (env, dir) => {
    const claudeJson = join(dir, '.claude.json')
    await writeFile(claudeJson, JSON.stringify({ oauthAccount: { displayName: 'Suleiman' } }))
    const taken = await run(['add', 'claude', 'suleiman'], env, { claudeJson: () => claudeJson })
    assert.equal(taken.code, 1)
    assert.match(taken.err.join('\n'), /already/)
  }))

test('add for Codex says the page to copy into a private window, and refuses an account on the list already, leaving no folder', () =>
  inDir(async env => {
    const wiring = loginWiring(env)
    const folder = join(wiring.codexDir(), 'codex-new')
    const loginCodex: LoginWiring['loginCodex'] = async opts => {
      opts.onUrl?.('https://auth.example/sign-in')
      await mkdir(folder, { recursive: true })
      return { ok: true, login: 'codex-new', who: { key: 'same/ws' } }
    }
    const added = await run(['add', 'codex', 'Dani'], env, { loginCodex, codexWho: () => Promise.resolve({ key: 'other/ws' }) })
    assert.equal(added.code, 0)
    assert.match(added.err.join('\n'), /private window.*https:\/\/auth\.example\/sign-in/)
    const twice = await run(['add', 'codex', 'Rom'], env, { loginCodex, codexWho: () => Promise.resolve({ key: 'same/ws' }) })
    assert.equal(twice.code, 1)
    assert.match(twice.err.join('\n'), /on the list already/)
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

test('on a server add and remove are refused and say where it is done, with nothing changed; list and use-first still work', () =>
  inDir(async env => {
    const server = { ...env, OPENAGENT_SERVER: '1' }
    addAccount('Dani', 'x', accountsPath('claude', server))
    let minted = 0
    const mint: LoginWiring['mint'] = () => {
      minted++
      return Promise.resolve({ ok: true, login: 'y' })
    }
    for (const argv of [['add', 'claude', 'Rom'], ['remove', 'claude', 'Dani']]) {
      const refused = await run(argv, server, { mint })
      assert.equal(refused.code, 1)
      assert.match(refused.err.join('\n'), /Settings › Accounts/)
    }
    assert.equal(minted, 0)
    assert.deepEqual(readAccounts(accountsPath('claude', server)).map(a => a.name), ['This computer', 'Dani'])
    assert.equal((await run(['list'], server)).code, 0)
    assert.equal((await run(['use-first', 'claude', 'Dani'], server)).code, 0)
  }))

test('a command that cannot be read says the usage and exits 2', () =>
  inDir(async env => {
    for (const argv of [[], ['nope'], ['list', 'claude'], ['add'], ['add', 'claude'], ['add', 'gemini', 'Rom'], ['add', 'claude', 'Rom', 'extra']]) {
      const wrong = await run(argv, env)
      assert.equal(wrong.code, 2, argv.join(' '))
      assert.match(wrong.err.join('\n'), /usage: account-rotation/)
    }
    assert.deepEqual(await readFile(accountsPath('claude', env), 'utf8').catch(() => 'no file'), 'no file')
  }))
