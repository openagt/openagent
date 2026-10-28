import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { lookupProvidedCommand, readProvidedCommand, runPackageCommand } from './provided-command.js'

// Which package provides a kind (#1774, #1820), against real files: a throwaway project whose
// package.json lists dependencies, each installed under node_modules with its own package.json.

const ECHO = `process.stdout.write(JSON.stringify(process.argv.slice(2)))`

/** A project listing `deps`; `named` is the project's own `openagent` key, when given. */
async function project(deps: Record<string, Record<string, unknown>>, named?: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'provided-command-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])), ...(named ? { openagent: named } : {}) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'cmd.cjs'), ECHO)
  }
  return root
}

test('one package declaring a kind provides it; a declaration naming no command of the package is none; nobody declaring is nothing, and no problem', async () => {
  const root = await project({
    plain: { bin: { plain: 'cmd.cjs' } },
    'wrong-bin': { bin: { a: 'cmd.cjs' }, openagent: { runs: 'b' } },
    logs: { bin: { logs: 'cmd.cjs' }, openagent: { runs: 'logs' } },
  })
  try {
    const found = await lookupProvidedCommand(root, 'runs')
    assert.equal(found.command?.package, 'logs')
    assert.equal(found.command?.name, 'logs')
    assert.equal(found.command?.bin, join(root, 'node_modules', 'logs', 'cmd.cjs'))
    assert.equal(found.problem, undefined)
    assert.deepEqual(await lookupProvidedCommand(root, 'tickets'), {}, 'another kind: nobody declares it, and that is no problem')
    assert.equal(await readProvidedCommand(root, 'tickets'), undefined)
    assert.deepEqual(await lookupProvidedCommand(join(root, 'nowhere'), 'runs'), {}, 'no package.json: nothing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('two packages declaring a kind: the one the project names provides; none named is none, with the reason; a name that does not provide it is none, said', async () => {
  const two = { github: { bin: { github: 'cmd.cjs' }, openagent: { 'git-host': 'github' } }, gitlab: { bin: { gitlab: 'cmd.cjs' }, openagent: { 'git-host': 'gitlab' } } }
  const unnamed = await project(two)
  const named = await project(two, { 'git-host': 'gitlab' })
  const wrong = await project(two, { 'git-host': 'plain' })
  const wrongAlone = await project({ github: two.github }, { 'git-host': 'plain' })
  try {
    const none = await lookupProvidedCommand(unnamed, 'git-host')
    assert.equal(none.command, undefined, 'never the first in dependency order')
    assert.equal(none.problem, '2 packages provide git-host: github, gitlab; name one under "openagent" in package.json')
    assert.equal(await readProvidedCommand(unnamed, 'git-host'), undefined)

    const picked = await lookupProvidedCommand(named, 'git-host')
    assert.equal(picked.command?.package, 'gitlab')
    assert.equal(picked.problem, undefined)

    assert.deepEqual(await lookupProvidedCommand(wrong, 'git-host'), { problem: 'package.json names plain for git-host, which does not provide it; the providers are github, gitlab' })
    assert.deepEqual(await lookupProvidedCommand(wrongAlone, 'git-host'), { problem: 'package.json names plain for git-host, which does not provide it; the providers are github' }, 'a wrong name is wrong even with one provider')
  } finally {
    for (const root of [unnamed, named, wrong, wrongAlone]) await rm(root, { recursive: true, force: true })
  }
})

test('packages the caller ships provide a kind only when none of the project\'s own packages declares it', async () => {
  const shippedRoot = await project({ shipped: { bin: { s: 'cmd.cjs' }, openagent: { runs: 's' } } })
  const shipped = [{ name: 'shipped', dir: join(shippedRoot, 'node_modules', 'shipped'), manifest: { name: 'shipped', bin: { s: 'cmd.cjs' }, openagent: { runs: 's' } } }]
  const bare = await project({ plain: { bin: { plain: 'cmd.cjs' } } })
  const own = await project({ logs: { bin: { records: 'cmd.cjs' }, openagent: { runs: 'records' } } })
  try {
    assert.equal((await lookupProvidedCommand(bare, 'runs', shipped)).command?.package, 'shipped')
    assert.equal((await lookupProvidedCommand(join(bare, 'nowhere'), 'runs', shipped)).command?.package, 'shipped', 'no package.json at all')
    assert.equal((await lookupProvidedCommand(own, 'runs', shipped)).command?.package, 'logs', 'the project\'s own package wins')
    assert.deepEqual(await lookupProvidedCommand(bare, 'tickets', shipped), {}, 'a kind no shipped package declares')
    // A name the caller brings itself is not read from the project: its copy there does not provide, shipped to this project or not.
    assert.deepEqual(await lookupProvidedCommand(own, 'runs', [], ['logs']), {}, 'reserved, and not shipped to this project')
    assert.equal((await lookupProvidedCommand(own, 'runs', shipped, ['logs'])).command?.package, 'shipped', 'reserved: the caller\'s own package provides')
    assert.equal((await lookupProvidedCommand(own, 'runs', shipped, ['other'])).command?.package, 'logs', 'another name reserved changes nothing')
  } finally {
    for (const dir of [shippedRoot, bare, own]) await rm(dir, { recursive: true, force: true })
  }
})

/** A skill's text in the project, as an installer copies it in: the folder named after the skill, with its `SKILL.md`. */
async function skillText(root: string, name: string, frontMatter: string): Promise<void> {
  await mkdir(join(root, '.agents/skills', name), { recursive: true })
  await writeFile(join(root, '.agents/skills', name, 'SKILL.md'), `---\nname: ${name}\n${frontMatter}\n---\nThe ${name} skill.\n`)
}

test('a skill text naming its package provides through it, fetched with npx and kept an hour; never fetched for a name installed or reserved, and a fetch that failed is tried again', async () => {
  // npx kept off the network: a stand-in on the PATH says what it was asked and runs the command
  // the way npx does, its folder's `node_modules/.bin` first on the PATH.
  const tools = await realpath(await mkdtemp(join(tmpdir(), 'provided-npx-')))
  const cache = join(tools, '_npx', 'f00d', 'node_modules')
  for (const [name, kind] of [['texthost', 'git-host'], ['@scope/textlogs', 'runs']] as const) {
    await mkdir(join(cache, name), { recursive: true })
    await writeFile(join(cache, name, 'package.json'), JSON.stringify({ name, bin: { cmd: 'cmd.cjs' }, openagent: { [kind]: 'cmd' } }))
    await writeFile(join(cache, name, 'cmd.cjs'), ECHO)
  }
  await mkdir(join(cache, '.bin'), { recursive: true })
  await mkdir(join(tools, 'bin'))
  await writeFile(join(tools, 'bin', 'npx'), `#!/bin/sh\necho "$2" >> "${tools}/asked"\ncase "$2" in *missing*) exit 1;; esac\nPATH="${cache}/.bin:$PATH" exec "$4" "$5" "$6"\n`)
  await chmod(join(tools, 'bin', 'npx'), 0o755)
  const asked = async () => (await readFile(join(tools, 'asked'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

  const bare = await project({})
  await skillText(bare, 'github', 'package: "texthost@0.1"')
  await skillText(bare, 'logs', "package: '@scope/textlogs@0.2'")
  await skillText(bare, 'plain', 'description: a skill with no package')
  await mkdir(join(bare, '.claude/skills'), { recursive: true })
  await symlink('../../.agents/skills/github', join(bare, '.claude/skills/github'))
  const installed = await project({ texthost: { bin: { mine: 'cmd.cjs' }, openagent: { 'git-host': 'mine' } } })
  await skillText(installed, 'github', 'package: "texthost@0.1"')
  const missing = await project({})
  await skillText(missing, 'github', 'package: "missing-host@1"')
  const unranged = await project({})
  await skillText(unranged, 'github', 'package: "texthost"')

  const path = process.env.PATH
  process.env.PATH = `${join(tools, 'bin')}${delimiter}${path}`
  try {
    const found = await lookupProvidedCommand(bare, 'git-host')
    assert.deepEqual(found.command, { package: 'texthost', name: 'cmd', bin: join(cache, 'texthost', 'cmd.cjs'), dir: join(cache, 'texthost') })
    assert.equal((await readProvidedCommand(bare, 'runs'))?.package, '@scope/textlogs', 'a scoped name, quoted either way')
    assert.deepEqual(await asked(), ['--package=texthost@0.1', '--package=@scope/textlogs@0.2'], 'each text once, its link in .claude/skills asking nothing more')
    assert.deepEqual(await runPackageCommand(bare, found.command!, ['home']), { ok: true, output: ['home'] }, 'the fetched command runs')

    assert.equal((await readProvidedCommand(bare, 'git-host'))?.package, 'texthost')
    assert.equal((await asked()).length, 2, 'a fetched package is kept: npx is not asked again within the hour')

    assert.deepEqual(await lookupProvidedCommand(bare, 'git-host', [], ['texthost']), {}, 'a reserved name is not read from the text')
    assert.equal((await readProvidedCommand(installed, 'git-host'))?.name, 'mine', 'the installed package wins over the text naming it')
    assert.equal((await readProvidedCommand(unranged, 'git-host')), undefined, 'a name with no range is no package line')
    assert.equal((await asked()).length, 2, 'none of those fetched anything')

    assert.deepEqual(await lookupProvidedCommand(missing, 'git-host'), {}, 'a fetch that failed provides nothing')
    assert.deepEqual(await lookupProvidedCommand(missing, 'git-host'), {})
    assert.deepEqual((await asked()).slice(2), ['--package=missing-host@1', '--package=missing-host@1'], 'and is not kept: the next ask tries again')
  } finally {
    process.env.PATH = path
    for (const dir of [tools, bare, installed, missing, unranged]) await rm(dir, { recursive: true, force: true })
  }
})

test('a package command runs with Node in the project and answers its JSON, its last stderr line, or that it printed none', async () => {
  const root = await project({ tool: { bin: { tool: 'cmd.cjs' }, openagent: { thing: 'tool' } } })
  const dir = join(root, 'node_modules', 'tool')
  await writeFile(join(dir, 'fails.cjs'), `process.stderr.write('first\\nno such thing\\n'); process.exit(1)`)
  await writeFile(join(dir, 'text.cjs'), `process.stdout.write('hello')`)
  await writeFile(join(dir, 'cwd.cjs'), `process.stdout.write(JSON.stringify(process.cwd()))`)
  try {
    const command = (await readProvidedCommand(root, 'thing'))!
    assert.deepEqual(await runPackageCommand(root, command, ['list', '--all']), { ok: true, output: ['list', '--all'] })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'fails.cjs') }, []), { ok: false, error: 'no such thing' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'text.cjs') }, []), { ok: false, error: 'tool printed no JSON' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'cwd.cjs') }, []), { ok: true, output: await realpath(root) })
    // What a caller adds is what the command is started with, beside what this process has, and for that command alone.
    await writeFile(join(dir, 'said.cjs'), `process.stdout.write(JSON.stringify([process.env.OPENAGENT_TEST_SAID ?? null, typeof process.env.PATH]))`)
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'said.cjs') }, [], { OPENAGENT_TEST_SAID: 'a word' }), { ok: true, output: ['a word', 'string'] })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'said.cjs') }, []), { ok: true, output: [null, 'string'] })
    assert.equal(process.env.OPENAGENT_TEST_SAID, undefined)
    // What it is handed it reads on standard input; a command handed nothing reads an input that ended, and waits for nothing.
    await writeFile(join(dir, 'read.cjs'), `let s = ''; process.stdin.on('data', d => (s += d)).on('end', () => process.stdout.write(JSON.stringify(s)))`)
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'read.cjs') }, [], undefined, 'a login'), { ok: true, output: 'a login' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'read.cjs') }, []), { ok: true, output: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
