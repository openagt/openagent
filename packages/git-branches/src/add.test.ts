import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from './git.js'
import { addProject, addRefusalLine, projectsOf, PROJECTS_ENV } from './add.js'
import { foundCopies } from './session-folder.js'
import { runCli } from './cli.js'

// `add`: an agent brings one of the person's projects into its session, by the project's name, as
// a copy in the session's folder; with real git.

const git = nodeGitRunner()

/** A folder holding a project with an origin, `shop`, and a sessions home. */
async function place(): Promise<{ dir: string; home: string; shop: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'git-branches-add-')))
  const shop = join(dir, 'shop')
  await git(['init', '-q', '--bare', '-b', 'main', join(dir, 'shop.git')], dir)
  await git(['init', '-q', '-b', 'main', shop], dir)
  await writeFile(join(shop, 'README.md'), '# shop\n')
  await git(['add', '-A'], shop)
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first'], shop)
  await git(['remote', 'add', 'origin', join(dir, 'shop.git')], shop)
  await git(['push', '-q', 'origin', 'main'], shop)
  return { dir, home: join(dir, 'home'), shop }
}

test('the projects an environment hands the agent are a JSON list; anything else is none', () => {
  assert.deepEqual(projectsOf({ [PROJECTS_ENV]: JSON.stringify([{ name: 'shop', dir: '/w/shop' }, { name: 3 }]) }), [{ name: 'shop', dir: '/w/shop' }])
  assert.deepEqual(projectsOf({ [PROJECTS_ENV]: 'shop' }), [])
  assert.deepEqual(projectsOf({}), [])
})

test("a project brought in by its name is a copy in the session's folder, on the session's branch; asked again, the copy it has is answered", async () => {
  const at = await place()
  try {
    const projects = [{ name: 'Shop', dir: at.shop }]
    const added = await addProject(at.home, 'run1', projects, 'shop', git)
    const copy = join(at.home, 'run1', 'shop')
    assert.deepEqual(added, { ok: true, project: 'Shop', copy, branch: 'agent-run1', existing: false })
    assert.equal((await git(['branch', '--show-current'], copy)).trim(), 'agent-run1')
    assert.deepEqual(await foundCopies(at.home, 'run1', [], git), [{ name: 'shop', from: at.shop }], 'the copy names its folder: the run takes it in as one of its repos')
    assert.deepEqual(await addProject(at.home, 'run1', projects, 'SHOP', git), { ok: true, project: 'Shop', copy, branch: 'agent-run1', existing: true })
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('a name that is no project of the session is refused, naming the ones it has; outside a session there is none to add to', async () => {
  const unknown = await addProject('/nowhere', 'run1', [{ name: 'shop', dir: '/w/shop' }, { name: 'blog', dir: '/w/blog' }], 'billing')
  assert.deepEqual(unknown, { ok: false, reason: 'unknown-project', project: 'billing', projects: ['shop', 'blog'] })
  assert.equal(addRefusalLine(unknown as Extract<typeof unknown, { ok: false }>), 'no project named billing; the projects are shop, blog')
  assert.deepEqual(await addProject('/nowhere', undefined, [], 'shop'), { ok: false, reason: 'no-session' })
})

test('the command reads the projects and the session from its environment, prints JSON, and exits 1 on a refusal', async () => {
  const before = { ...process.env }
  const out: string[] = []
  const err: string[] = []
  try {
    process.env.OPENAGENT_PROJECTS = JSON.stringify([{ name: 'shop', dir: '/w/shop' }])
    process.env.OPENAGENT_SESSION = 'run1'
    assert.equal(await runCli(['add', 'billing'], { cwd: tmpdir(), stdout: line => out.push(line), stderr: line => err.push(line) }, git), 1)
    assert.equal(JSON.parse(out[0]!).reason, 'unknown-project')
    assert.equal(err[0], 'no project named billing; the projects are shop')
    assert.equal(await runCli(['add'], { cwd: tmpdir(), stdout: () => {}, stderr: () => {} }, git), 2)
  } finally {
    process.env = before
  }
})
