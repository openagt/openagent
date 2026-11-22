import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chainStore, COMPUTER, defineSetting, PERSON, projectScope, settingsIn, type ProjectRef } from '@openagt/hooks'
import { filesystemBackend } from './backend.js'
import { foldersOf, type Folders } from './folders.js'

// The store on this computer: each scope in its folder, files written whole and removed with the
// folders they leave empty, saves made from the files as they are, watchers, and the settings.

const SHOP: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/home/me/shop', remote: 'github.com/acme/shop' }
const NOTES: ProjectRef = { id: 'notes-1', name: 'notes', dir: '/home/me/notes' }

/** `promise`, or a failure saying `what` once `ms` passed without it. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), ms)))])
  } finally {
    clearTimeout(timer)
  }
}

async function setup(): Promise<{ folders: Folders; cleanup: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-filesystem-')))
  return { folders: foldersOf({ XDG_CONFIG_HOME: base }), cleanup: () => rm(base, { recursive: true, force: true }) }
}

test("the person's own folder is beside the registry, under XDG_CONFIG_HOME when set, else ~/.openagent; this computer's is beside it", () => {
  assert.deepEqual(foldersOf({ XDG_CONFIG_HOME: '/x/config', HOME: '/home/me' }), { personal: '/x/config/openagent', computer: '/x/config/openagent-computer' })
  assert.deepEqual(foldersOf({ HOME: '/home/me' }), { personal: '/home/me/.openagent', computer: '/home/me/.openagent-computer' })
})

test("each scope has a folder of its own: the person's and each project's in the person's folder, a project by its repository's address or its folder; this computer's beside it", async () => {
  const { folders, cleanup } = await setup()
  try {
    const store = chainStore([filesystemBackend({ folders })])
    await store.save(PERSON, { 'profiles/default.json': '{}\n' }, 'profile')
    await store.save(COMPUTER, { 'settings.json': '{}\n' }, 'setting')
    await store.save(projectScope(SHOP), { 'tickets/a.md': '# A\n' }, 'ticket')
    await store.save(projectScope(NOTES), { 'queue.md': '- one\n' }, 'queue')
    assert.equal(await readFile(join(folders.personal, 'person', 'profiles', 'default.json'), 'utf8'), '{}\n')
    assert.equal(await readFile(join(folders.computer, 'data', 'settings.json'), 'utf8'), '{}\n')
    assert.equal(await readFile(join(folders.personal, 'projects', 'github.com', 'acme', 'shop', 'tickets', 'a.md'), 'utf8'), '# A\n')
    assert.equal(await readFile(join(folders.personal, 'projects', 'local', 'home', 'me', 'notes', 'queue.md'), 'utf8'), '- one\n')
    assert.deepEqual((await readdir(folders.personal)).sort(), ['person', 'projects'], "nothing of this computer's is in the person's folder, the locks included")
    assert.equal(await store.read(projectScope({ ...SHOP, id: 'shop-on-another-computer', dir: '/srv/shop' }), 'tickets/a.md'), '# A\n', 'the same repository is the same project on every computer')
  } finally {
    await cleanup()
  }
})

test('a save writes each file whole and removes with null, taking the folders it empties; a list is every file under a folder, sorted', async () => {
  const { folders, cleanup } = await setup()
  try {
    const store = chainStore([filesystemBackend({ folders })])
    const scope = projectScope(SHOP)
    await store.save(scope, { 'runs/ada/1.json': '{"id":"1"}', 'runs/ada/2.json': '{"id":"2"}', 'runs/bob/3.json': '{"id":"3"}', 'tickets/a.md': '# A' }, 'records')
    assert.deepEqual(await store.list(scope, 'runs'), ['runs/ada/1.json', 'runs/ada/2.json', 'runs/bob/3.json'])
    assert.deepEqual(await store.list(scope, ''), ['runs/ada/1.json', 'runs/ada/2.json', 'runs/bob/3.json', 'tickets/a.md'])
    await store.save(scope, { 'runs/bob/3.json': null, 'runs/ada/1.json': '{"id":"1","status":"done"}' }, 'one removed, one changed')
    assert.equal(await store.read(scope, 'runs/ada/1.json'), '{"id":"1","status":"done"}')
    assert.equal(await store.read(scope, 'runs/bob/3.json'), undefined)
    assert.deepEqual((await readdir(join(folders.personal, 'projects', 'github.com', 'acme', 'shop', 'runs'))).sort(), ['ada'], 'the emptied folder went with its last file')
    await store.save(scope, { 'tickets/a.md': null, 'tickets/gone.md': null }, 'a file that is not there is removed all the same')
    assert.deepEqual(await store.list(scope, 'tickets'), [])
    assert.deepEqual(await store.list(scope, 'nothing'), [])
    assert.deepEqual(await store.list(scope, 'runs/ada/1.json'), [], 'a file holds no files')
    assert.equal(await store.read(scope, 'runs'), undefined, 'a folder reads as no file')
    assert.deepEqual(await store.list(projectScope(NOTES), ''), [], 'a project never saved to has no files')
    await assert.rejects(store.save(scope, { '../notes/queue.md': 'x' }, 'escape'), /is no path in a store/)
    await assert.rejects(store.read(scope, '/etc/passwd'), /is no path in a store/)
  } finally {
    await cleanup()
  }
})

test("a file being written is never read half-written or listed, and a scope's folder is read past git's own", async () => {
  const { folders, cleanup } = await setup()
  try {
    const store = chainStore([filesystemBackend({ folders })])
    const dir = join(folders.personal, 'projects', 'github.com', 'acme', 'shop')
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/agent-data\n')
    await writeFile(join(dir, '.queue.md.123.openagent-writing'), '- half')
    await store.save(projectScope(SHOP), { 'queue.md': '- one\n' }, 'queue')
    assert.deepEqual(await store.list(projectScope(SHOP), ''), ['queue.md'])
  } finally {
    await cleanup()
  }
})

test('a save made from the files as they are: two at once both keep their change, and one that throws writes nothing', async () => {
  const { folders, cleanup } = await setup()
  try {
    const store = chainStore([filesystemBackend({ folders })])
    const add = (name: string) =>
      store.save(
        COMPUTER,
        async files => ({ 'names.txt': `${(await files.read('names.txt')) ?? ''}${name}\n` }),
        `add ${name}`,
      )
    await Promise.all([add('ada'), add('bob'), add('cy')])
    assert.deepEqual((await store.read(COMPUTER, 'names.txt'))?.split('\n').filter(Boolean).sort(), ['ada', 'bob', 'cy'])
    await assert.rejects(
      store.save(
        COMPUTER,
        () => {
          throw new Error('bob is not here')
        },
        'remove bob',
      ),
      /bob is not here/,
    )
    assert.equal((await store.read(COMPUTER, 'names.txt'))?.split('\n').filter(Boolean).length, 3)
  } finally {
    await cleanup()
  }
})

test('a watcher hears each file changed under its folder, and nothing once it stopped', async () => {
  const { folders, cleanup } = await setup()
  try {
    const store = chainStore([filesystemBackend({ folders })])
    const scope = projectScope(SHOP)
    const heard: string[] = []
    let told: () => void = () => {}
    const stop = store.watch(scope, 'tickets', path => {
      heard.push(path)
      if (path === 'tickets/a.md') told()
    })
    // The watch starts once its folder is there: a moment after it is asked.
    await new Promise(resolve => setTimeout(resolve, 100))
    const arrived = new Promise<void>(resolve => (told = resolve))
    await store.save(scope, { 'queue.md': '- one\n', 'tickets/a.md': '# A\n' }, 'two files')
    await within(arrived, 5000, 'the watcher heard nothing')
    assert.ok(
      heard.every(path => path === 'tickets' || path.startsWith('tickets/')),
      `only what is under tickets is told: ${heard.join(', ')}`,
    )
    assert.ok(!heard.some(path => path.endsWith('.openagent-writing')), 'a file being written is not told')
    stop()
    const before = heard.length
    await store.save(scope, { 'tickets/b.md': '# B\n' }, 'one more')
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(heard.length, before, 'a watcher that stopped hears nothing more')
  } finally {
    await cleanup()
  }
})

test("the settings, kept in each scope's folder: a project's with the project's files", async () => {
  const { folders, cleanup } = await setup()
  try {
    const settings = settingsIn(chainStore([filesystemBackend({ folders })]))
    const pace = defineSetting<number>({ key: 'scheduled-agents.pace', scope: 'project', default: 6, parse: value => (typeof value === 'number' ? value : undefined) })
    const editor = defineSetting<string>({ key: 'projects.editor', scope: 'computer', default: 'code', parse: value => (typeof value === 'string' ? value : undefined) })
    await Promise.all([settings.set(pace, 2, SHOP), settings.set(editor, 'zed')])
    assert.equal(await settings.get(pace, SHOP), 2)
    assert.equal(await settings.get(pace, NOTES), 6)
    assert.equal(await settings.get(editor), 'zed')
    assert.equal(await readFile(join(folders.personal, 'projects', 'github.com', 'acme', 'shop', 'settings.json'), 'utf8'), '{\n  "scheduled-agents.pace": 2\n}\n')
    assert.equal(await readFile(join(folders.computer, 'data', 'settings.json'), 'utf8'), '{\n  "projects.editor": "zed"\n}\n')
  } finally {
    await cleanup()
  }
})
