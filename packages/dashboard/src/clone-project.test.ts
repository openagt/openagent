import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canRead, cloneProject, cloneTarget, cloneTargetOf, type CloneRunner } from './clone-project.js'

const HOME = '/home/ada'

test('an address is read as a person types it, and goes to the projects folder under the repository\'s own name', () => {
  const shop = { address: 'github.com/ada/shop', path: '/home/ada/projects/shop' }
  assert.deepEqual(cloneTarget('github.com/ada/shop', HOME), { url: 'https://github.com/ada/shop', ...shop })
  assert.deepEqual(cloneTarget('  https://github.com/ada/shop/ ', HOME), { url: 'https://github.com/ada/shop', ...shop })
  assert.deepEqual(cloneTarget('https://github.com/ada/shop.git', HOME), { url: 'https://github.com/ada/shop.git', ...shop })
  assert.deepEqual(cloneTarget('git@github.com:ada/shop.git', HOME), { url: 'git@github.com:ada/shop.git', ...shop })
  assert.deepEqual(cloneTarget('ssh://git@github.com:22/ada/shop.git', HOME), { url: 'ssh://git@github.com:22/ada/shop.git', ...shop })
  // The kind of address is written as git spells it, whatever the person's capitals.
  assert.deepEqual(cloneTarget('SSH://git@github.com/ada/shop.git', HOME), { url: 'ssh://git@github.com/ada/shop.git', ...shop })
  assert.deepEqual(cloneTarget('HTTPS://github.com/ada/shop', HOME), { url: 'https://github.com/ada/shop', ...shop })
  // The folder keeps the name's letters as typed; the address is the one every machine knows the project by.
  assert.deepEqual(cloneTarget('gitlab.example.com/Team/Sub/My.App', HOME), { url: 'https://gitlab.example.com/Team/Sub/My.App', address: 'gitlab.example.com/team/sub/my.app', path: '/home/ada/projects/My.App' })
})

test('what is no repository\'s address is none: a folder, another kind of address, a login in it, an option, a way out of the projects folder', () => {
  for (const typed of [
    '',
    'shop',
    'ada/shop', // no host: whose?
    '/Users/ada/shop',
    './shop',
    'file:///Users/ada/shop',
    'http://github.com/ada/shop', // not locked
    'ext::sh -c touch${IFS}/tmp/x',
    'ext::sh/x',
    '--upload-pack=touch /tmp/x',
    '-oProxyCommand=x@github.com:ada/shop',
    'https://token@github.com/ada/shop', // a login in the address
    'https://ada:secret@github.com/ada/shop',
    'https://github.com:8443/ada/shop',
    'github.com/ada/..',
    'github.com/ada/.git',
    'github.com/../../etc',
    'github.com/ada/-rf',
    'github.com/ada/shop?x=1',
    'github.com/ada/shop#main',
    'github.com/ada/sh op',
    'github.com/ada/shop\nmore',
    'git@github.com:-oProxyCommand=x/shop',
    `github.com/ada/${'x'.repeat(600)}`,
  ]) {
    assert.equal(cloneTarget(typed, HOME), undefined, typed)
  }
  assert.deepEqual(cloneTargetOf('ada/shop', HOME), { ok: false, error: '"ada/shop" is not a repository\'s address. One looks like github.com/you/project.' })
  assert.deepEqual(cloneTargetOf('github.com/ada/shop', HOME), { ok: true, address: 'github.com/ada/shop', path: '/home/ada/projects/shop' })
})

/** A git that clones nothing from anywhere: it makes the folder a repository whose origin is the address it was given. */
function pretendGit(): { run: CloneRunner; calls: { args: readonly string[]; env: NodeJS.ProcessEnv }[] } {
  const calls: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
  const run: CloneRunner = async (args, env) => {
    calls.push({ args, env })
    const [url, path] = args.slice(-2) as [string, string]
    execFileSync('git', ['init', '-q', path])
    execFileSync('git', ['-C', path, 'remote', 'add', 'origin', url])
    return { ok: true }
  }
  return { run, calls }
}

test('a repository is cloned into the projects folder, by the two ways in an address names and with no question to a person; one already there is taken as it is', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'openagent-clone-')))
  try {
    const git = pretendGit()
    const path = join(home, 'projects', 'shop')
    const none = async () => undefined
    assert.deepEqual(await cloneProject('github.com/ada/shop', { home, run: git.run, env: { PATH: '/bin' }, sshCommand: none }), { ok: true, path, cloned: true })
    // Made beside the folder, under a name no repository has, and moved there once it is whole.
    const made = git.calls[0]!.args.at(-1)!
    assert.match(made, new RegExp(`^${join(home, 'projects')}/\\.shop\\.cloning-[A-Za-z0-9]{6}$`))
    assert.deepEqual(git.calls[0]!.args.slice(0, -1), ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', 'clone', '--', 'https://github.com/ada/shop'])
    assert.deepEqual(git.calls[0]!.env, { PATH: '/bin', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' })
    assert.deepEqual(await readdir(join(home, 'projects')), ['shop'])

    // The same repository, typed another way: nothing is cloned again.
    assert.deepEqual(await cloneProject('git@github.com:Ada/shop.git', { home, run: git.run }), { ok: true, path, cloned: false })
    assert.equal(git.calls.length, 1)

    // Another repository of the same name, and a folder that is no repository: never written over.
    assert.deepEqual(await cloneProject('github.com/grace/shop', { home, run: git.run }), {
      ok: false,
      error: `${path} is already there, and it is not github.com/grace/shop. Move that folder away first, or add it as it is.`,
    })
    await mkdir(join(home, 'projects', 'notes'))
    await writeFile(join(home, 'projects', 'notes', 'keep.txt'), 'mine')
    assert.equal((await cloneProject('github.com/ada/notes', { home, run: git.run })).ok, false)
    assert.deepEqual(await readdir(join(home, 'projects', 'notes')), ['keep.txt'])
    assert.equal(git.calls.length, 1)

    // A person's own way to reach SSH is kept, from git's settings or from the environment, and is told the same: no question.
    await cloneProject('github.com/ada/tools', { home, run: git.run, env: {}, sshCommand: async () => 'ssh -i ~/.ssh/work' })
    assert.equal(git.calls[1]!.env.GIT_SSH_COMMAND, 'ssh -i ~/.ssh/work -oBatchMode=yes')
    await cloneProject('github.com/ada/more', { home, run: git.run, env: { GIT_SSH_COMMAND: 'ssh -F /dev/null' }, sshCommand: async () => 'ssh -i ~/.ssh/work' })
    assert.equal(git.calls[2]!.env.GIT_SSH_COMMAND, 'ssh -F /dev/null -oBatchMode=yes')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the same repository asked for twice at once is cloned once, and a folder still being cloned is no project yet', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'openagent-clone-')))
  try {
    const git = pretendGit()
    let seenWhileCloning: string[] = []
    const slow: CloneRunner = async (args, env, timeoutMs) => {
      await new Promise(resolve => setTimeout(resolve, 80))
      // What a second ask would find while the first clone is on its way: no `shop` yet.
      seenWhileCloning = (await readdir(join(home, 'projects'))).filter(name => !name.startsWith('.'))
      return git.run(args, env, timeoutMs)
    }
    const path = join(home, 'projects', 'shop')
    const [first, second, other] = await Promise.all([
      cloneProject('github.com/ada/shop', { home, run: slow }),
      cloneProject('https://github.com/ada/shop.git', { home, run: slow }),
      cloneProject('github.com/grace/shop', { home, run: slow }),
    ])
    assert.deepEqual(first, { ok: true, path, cloned: true })
    assert.deepEqual(second, { ok: true, path, cloned: false })
    assert.equal(other.ok, false, 'another repository of the same name is told the folder is taken, and removes nothing')
    assert.equal(git.calls.length, 1)
    assert.deepEqual(seenWhileCloning, [])
    assert.deepEqual(await readdir(join(home, 'projects')), ['shop'])

    // A folder that came to be there while the clone ran is not written over.
    const racing: CloneRunner = async (args, env, timeoutMs) => {
      await mkdir(join(home, 'projects', 'late'))
      await writeFile(join(home, 'projects', 'late', 'keep.txt'), 'mine')
      return git.run(args, env, timeoutMs)
    }
    assert.equal((await cloneProject('github.com/ada/late', { home, run: racing })).ok, false)
    assert.deepEqual((await readdir(join(home, 'projects'))).sort(), ['late', 'shop'])
    assert.deepEqual(await readdir(join(home, 'projects', 'late')), ['keep.txt'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a clone that fails leaves no folder, and says why in git\'s own last words; a repository this computer cannot read says what is missing', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'openagent-clone-')))
  try {
    const failing = (said: string, timedOut = false): CloneRunner => async args => {
      // What git leaves when it is stopped half-way.
      await mkdir(join(args.at(-1)!, '.git'), { recursive: true })
      return { ok: false, said, timedOut }
    }
    // Neither the folder nor the one the clone was being made in.
    const gone = async (name: string) => {
      assert.equal(await stat(join(home, 'projects', name)).then(() => true, () => false), false)
      assert.deepEqual(await readdir(join(home, 'projects')), [])
    }

    assert.deepEqual(await cloneProject('github.com/ada/private', { home, run: failing("Cloning into '/x'...\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\n") }), {
      ok: false,
      error: "This computer has no login that can read github.com/ada/private, or there is no such repository: a private one needs a login. git said: could not read Username for 'https://github.com': terminal prompts disabled",
    })
    await gone('private')
    assert.deepEqual(await cloneProject('example.com/ada/shop', { home, run: failing("fatal: unable to access 'https://example.com/ada/shop/': Could not resolve host: example.com\n") }), {
      ok: false,
      error: "unable to access 'https://example.com/ada/shop/': Could not resolve host: example.com",
    })
    // Over SSH git ends every failure with the same two lines: the reason is what comes before them.
    assert.deepEqual(await cloneProject('git@github.com:ada/private.git', { home, run: failing("Cloning into '/x'...\ngit@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n") }), {
      ok: false,
      error: 'This computer has no login that can read github.com/ada/private, or there is no such repository: a private one needs a login. git said: git@github.com: Permission denied (publickey). Could not read from remote repository.',
    })
    // A host this computer never met over SSH is not a missing login.
    assert.deepEqual(await cloneProject('git@git.example.com:ada/shop.git', { home, run: failing('Host key verification failed.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n') }), {
      ok: false,
      error: 'This computer has never met git.example.com over SSH, so it does not know it is the real one. Use the address that starts with https://, or connect to it once in a terminal. git said: Host key verification failed. Could not read from remote repository.',
    })
    assert.deepEqual(await cloneProject('git@git.example.com:ada/shop.git', { home, run: failing('ssh: connect to host git.example.com port 22: Operation timed out\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n') }), {
      ok: false,
      error: 'ssh: connect to host git.example.com port 22: Operation timed out Could not read from remote repository.',
    })
    assert.deepEqual(await cloneProject('github.com/ada/huge', { home, run: failing('', true) }), { ok: false, error: 'Cloning github.com/ada/huge took too long, and was stopped.' })
    await gone('huge')
    assert.deepEqual(await cloneProject('github.com/ada/quiet', { home, run: failing('') }), { ok: false, error: 'git could not clone it.' })
    assert.deepEqual(await cloneProject('not an address', { home, run: failing('') }), { ok: false, error: '"not an address" is not a repository\'s address. One looks like github.com/you/project.' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('whether the logins read a repository is asked of its host the way a clone asks, and said in the clone\'s words of the computer asked', async () => {
  const calls: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
  const answering = (said?: string, timedOut = false): CloneRunner => async (args, env) => {
    calls.push({ args, env })
    return said === undefined ? { ok: true } : { ok: false, said, timedOut }
  }
  const none = async () => undefined
  assert.deepEqual(await canRead('github.com/ada/shop', { run: answering(), env: { PATH: '/bin' }, sshCommand: none }), { ok: true })
  // Nothing is cloned: the host is asked for its branches, by the same ways in and with no question to a person.
  assert.deepEqual(calls[0]!.args, ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', 'ls-remote', '--heads', '--', 'https://github.com/ada/shop'])
  assert.deepEqual(calls[0]!.env, { PATH: '/bin', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' })

  const noLogin = "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"
  assert.deepEqual(await canRead('github.com/ada/private', { run: answering(noLogin), sshCommand: none }), {
    ok: false,
    error: "This computer has no login that can read github.com/ada/private, or there is no such repository: a private one needs a login. git said: could not read Username for 'https://github.com': terminal prompts disabled",
  })
  assert.deepEqual(await canRead('github.com/ada/private', { run: answering(noLogin), sshCommand: none }, 'experiment'), {
    ok: false,
    error: "experiment has no login that can read github.com/ada/private, or there is no such repository: a private one needs a login. git said: could not read Username for 'https://github.com': terminal prompts disabled",
  })
  assert.deepEqual(await canRead('github.com/ada/slow', { run: answering('', true), sshCommand: none }), { ok: false, error: 'github.com/ada/slow did not answer in time.' })
  assert.deepEqual(await canRead('not an address', { run: answering() }), { ok: false, error: '"not an address" is not a repository\'s address. One looks like github.com/you/project.' })
})

test('the real git refuses a way in an address does not name, even when asked for one', async () => {
  // What the two `protocol` settings are for: were an address ever read wrongly, git itself would still not run a program for it.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'openagent-clone-')))
  try {
    const marker = join(home, 'ran')
    assert.throws(() => execFileSync('git', ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', 'clone', '--', `ext::sh -c "touch ${marker}"`, join(home, 'x')], { stdio: 'pipe' }))
    assert.equal(await stat(marker).then(() => true, () => false), false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
