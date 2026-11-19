import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { initHooks, removeHooks, runsTool } from './init.js'

// `init` against real files: the scheduler's lines written into a fresh file, merged into a
// person's, and nothing written where the dashboard has no directory.

test('a project the dashboard knows, with no hooks file, gets the scheduler\'s lines', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-init-')))
  await mkdir(join(repo, '.openagent'))
  try {
    const outcome = await initHooks(repo)
    assert.deepEqual(outcome, { ok: true, file: join(repo, '.openagent', 'hooks.yml'), added: ['open', 'close'], kept: [] })
    assert.deepEqual(parse(await readFile(join(repo, '.openagent', 'hooks.yml'), 'utf8')), { open: ['scheduler start'], close: ['scheduler stop --unless-keep-alive'] })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a line that already runs the scheduler is its line, however it is spelled: init adds no second one', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-init-')))
  const file = join(repo, '.openagent', 'hooks.yml')
  await mkdir(join(repo, '.openagent'))
  try {
    // A person's own lines: one fetched by its command, and one by its package.
    await writeFile(file, '# mine\nopen:\n  - npx scheduler start\nclose:\n  - npx @openagt/skill-scheduler@0.1 stop\n')
    const before = await readFile(file, 'utf8')
    assert.deepEqual(await initHooks(repo), { ok: true, file, added: [], kept: [] })
    assert.equal(await readFile(file, 'utf8'), before, 'the file is as it was')

    // An open list that runs other things only gains the line; a close list that already stops it is kept.
    await writeFile(file, 'open:\n  - echo hello\nclose:\n  - scheduler stop\n')
    assert.deepEqual(await initHooks(repo), { ok: true, file, added: ['open'], kept: [] })
    assert.deepEqual(parse(await readFile(file, 'utf8')), { open: ['echo hello', 'scheduler start'], close: ['scheduler stop'] })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("a person's file keeps its lines and its comments, a list gains the scheduler's line, and a second init writes nothing", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-init-')))
  const file = join(repo, '.openagent', 'hooks.yml')
  await mkdir(join(repo, '.openagent'))
  try {
    await writeFile(file, '# my hooks\nopen:\n  - echo hello\nclose: echo bye\n')
    const outcome = await initHooks(repo)
    assert.deepEqual(outcome, { ok: true, file, added: ['open'], kept: ['close'] }, 'a key that is no list is a person\'s, and kept')
    const written = await readFile(file, 'utf8')
    assert.match(written, /^# my hooks\n/)
    assert.deepEqual(parse(written), { open: ['echo hello', 'scheduler start'], close: 'echo bye' })
    assert.deepEqual(await initHooks(repo), { ok: true, file, added: [], kept: ['close'] })
    assert.equal(await readFile(file, 'utf8'), written)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('no dashboard directory, or a file that is not YAML, is refused and nothing is written', async () => {
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-init-')))
  const broken = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-init-')))
  await mkdir(join(broken, '.openagent'))
  await writeFile(join(broken, '.openagent', 'hooks.yml'), 'open: [\n')
  try {
    const none = await initHooks(bare)
    assert.ok(!none.ok && none.reason === 'no-dashboard')
    await assert.rejects(readFile(join(bare, '.openagent', 'hooks.yml')))
    const unreadable = await initHooks(broken)
    assert.ok(!unreadable.ok && unreadable.reason === 'unreadable')
    assert.equal(await readFile(join(broken, '.openagent', 'hooks.yml'), 'utf8'), 'open: [\n')
  } finally {
    await rm(bare, { recursive: true, force: true })
    await rm(broken, { recursive: true, force: true })
  }
})

test('removeHooks takes out every line that runs the scheduler, and leaves the rest of the file as it was', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-init-')))
  const file = join(repo, '.openagent', 'hooks.yml')
  await mkdir(join(repo, '.openagent'))
  try {
    assert.deepEqual(await removeHooks(repo), { ok: true, file, removed: [] }, 'no file: nothing to take')
    await writeFile(file, '# mine\nopen:\n  - echo hello\n  - npx scheduler start\n  - scheduler start\nclose:\n  - scheduler stop --unless-keep-alive\n')
    assert.deepEqual(await removeHooks(repo), { ok: true, file, removed: ['open', 'close'] })
    assert.equal(await readFile(file, 'utf8'), '# mine\nopen:\n  - echo hello\n', 'a list left empty goes with its key; the comment and the other lines stay')
    assert.deepEqual(await removeHooks(repo), { ok: true, file, removed: [] }, 'asked again: nothing left to take')

    // A file that held only the scheduler's lines goes with them.
    await initHooks(repo)
    await writeFile(file, 'open:\n  - scheduler start\nclose:\n  - scheduler stop --unless-keep-alive\n')
    assert.deepEqual(await removeHooks(repo), { ok: true, file, removed: ['open', 'close'] })
    assert.equal(await readFile(file, 'utf8').catch(() => undefined), undefined, 'the file is gone')

    await writeFile(file, 'open: [')
    const unreadable = await removeHooks(repo)
    assert.ok(!unreadable.ok && unreadable.reason === 'unreadable')
    assert.equal(await readFile(file, 'utf8'), 'open: [', 'a file that cannot be read is not written')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a line runs a tool by its bare command, by a path, or by its package\'s name with or without a version', () => {
  for (const line of [
    'scheduler start',
    'npx scheduler start',
    'npx @openagt/skill-scheduler start',
    'npx @openagt/skill-scheduler@0.1 start',
    'npx @openagt/skill-scheduler@^0.1.2 start',
    'FOO=1 scheduler start',
    './node_modules/.bin/scheduler start',
    'node /opt/tools/bin/scheduler start --foreground',
    'cd sub&&scheduler start',
    '"scheduler" stop --unless-keep-alive',
    'echo `scheduler status`',
  ])
    assert.equal(runsTool(line), true, line)
})

test('a name inside another word, and a line that names nothing of the tool, do not run it', () => {
  for (const line of ['npx my-scheduler-wrapper start', 'echo scheduler-is-not-here', 'agent-runner run --detach "$PROMPT"', 'npx @other/scheduler-plus start', ''])
    assert.equal(runsTool(line), false, line)
})
