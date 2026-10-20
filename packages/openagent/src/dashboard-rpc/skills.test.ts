import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, stopScheduler } from '@openagt/skill-scheduler'
import { addProject, listProjects } from '../registry.js'
import { readProjectModules } from '../project-modules.js'
import { provideTestContext } from './test-context.js'
import { onCommands } from './projects.js'
import { hostName, onProjectSkills, sendChangeSkills, sendProjectSkills } from './skills.js'

// A project's skills through the dashboard's own calls, against a real folder and real git, with
// the registry pointed at a temp $XDG_CONFIG_HOME so the person's own is never touched.
async function project(): Promise<{ dir: string; id: string; git: (...args: string[]) => string; restore: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-rpc-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(base, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  const dir = join(base, 'app')
  await mkdir(dir)
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'tester@example.com')
  git('config', 'user.name', 'tester')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(join(dir, 'README.md'), '# app\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  await addProject(dir, new Date().toISOString())
  provideTestContext()
  const id = (await listProjects()).find(p => p.path === dir)!.id
  return {
    dir,
    id,
    git,
    restore: async () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      await rm(base, { recursive: true, force: true })
    },
  }
}

/** Whether a process is still there. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const flat = (skills: NonNullable<Awaited<ReturnType<typeof onProjectSkills>>>) => skills.groups.flatMap(group => group.skills)
const held = (skills: NonNullable<Awaited<ReturnType<typeof onProjectSkills>>>) => flat(skills).filter(skill => skill.standing !== 'absent').length

test('a project\'s skills: none yet; written, they are in the folder and wait to reach the branch agents start from; committed, they no longer wait', async () => {
  const { dir, id, git, restore } = await project()
  try {
    const empty = (await onProjectSkills(id))!
    assert.deepEqual({ startBranch: empty.startBranch, uncommitted: empty.uncommitted, git: empty.git, remote: empty.remote, local: empty.local }, { startBranch: 'main', uncommitted: [], git: true, remote: undefined, local: false })
    assert.deepEqual(empty.groups.map(group => [group.title, group.skills.length]), [['Tickets and queue', 7], ['Reviews and research', 8], ['Pull requests', 1], ['After a merge', 1], ['Automations', 1], ['Needs its own setup', 2]])
    assert.ok(flat(empty).every(skill => skill.standing === 'absent' && !skill.waiting && skill.description.length > 10))

    const written = await sendChangeSkills(id, { write: ['browser', 'plan'] })
    assert.deepEqual(written, { ok: true, written: ['browser', 'plan'], removed: [], left: [] })
    assert.match(await readFile(join(dir, '.agents/skills/browser/SKILL.md'), 'utf8'), /^---\nname: browser\n/)
    const waiting = (await onProjectSkills(id))!
    assert.equal(held(waiting), 2)
    assert.deepEqual(waiting.uncommitted, ['plan', 'browser'])
    assert.deepEqual(flat(waiting).filter(skill => skill.waiting).map(skill => skill.name), ['plan', 'browser'])
    assert.deepEqual(flat(waiting).filter(skill => skill.standing === 'current').map(skill => skill.name), ['plan', 'browser'])
    // The page follows the text in the folder at once; the launcher says the command has yet to reach the branch.
    assert.ok((await readProjectModules(dir)).some(module => module.package === '@openagt/skill-browser'))
    assert.deepEqual((await onCommands(id))!.commands.map(command => [command.name, command.waiting]), [['plan', 'main']])

    // By name, as after a save: the files of that skill alone. With no remote, agents start from this folder's commits: the commit is the send.
    assert.deepEqual(await sendProjectSkills(id, ['plan']), { ok: true, sent: 'committed' })
    assert.equal(git('show', '--format=', '--name-only', 'HEAD'), '.agents/skills/plan/SKILL.md\n.claude/skills/plan\n')
    assert.deepEqual((await onProjectSkills(id))!.uncommitted, ['browser'])
    assert.deepEqual(await sendProjectSkills(id, ['../x']), { ok: false, error: 'not a list of skills' })
    // Unnamed, as the page's Send: everything still on its way.
    assert.deepEqual(await sendProjectSkills(id), { ok: true, sent: 'committed' })
    assert.equal(git('log', '--format=%s').trim(), 'Update OpenAgent skills\nUpdate OpenAgent skills\ninit')
    const after = (await onProjectSkills(id))!
    assert.deepEqual(after.uncommitted, [])
    assert.deepEqual(flat(after).filter(skill => skill.waiting), [])
    assert.deepEqual((await onCommands(id))!.commands.map(command => [command.name, command.waiting]), [['plan', undefined]])
    assert.deepEqual(await sendProjectSkills(id), { ok: false, error: 'no skill to send' })

    // A tick removed deletes; a text changed since it was written is told as such.
    assert.deepEqual(await sendChangeSkills(id, { remove: ['plan'] }), { ok: true, written: [], removed: ['plan'], left: [] })
    await writeFile(join(dir, '.agents/skills/browser/SKILL.md'), (await readFile(join(dir, '.agents/skills/browser/SKILL.md'), 'utf8')).replace(/\n---\n/, '\n---\nOur own line.\n'))
    const changed = (await onProjectSkills(id))!
    assert.equal(held(changed), 1)
    assert.equal(flat(changed).find(skill => skill.name === 'browser')!.standing, 'changed')
    assert.equal(flat(changed).find(skill => skill.name === 'plan')!.standing, 'absent')
  } finally {
    await restore()
  }
})

test('with a remote the branch agents start from is the remote\'s: a skill committed here still waits until it is there', async () => {
  const { dir, id, git, restore } = await project()
  try {
    git('init', '-q', '--bare', join(dir, '..', 'origin.git'))
    git('remote', 'add', 'origin', join(dir, '..', 'origin.git'))
    git('push', '-q', '-u', 'origin', 'main')
    await sendChangeSkills(id, { write: ['triage'] })
    const { commitSkills } = await import('@openagt/init')
    await commitSkills(dir, ['triage'])
    const local = (await onProjectSkills(id))!
    assert.equal(local.startBranch, 'main')
    assert.deepEqual(flat(local).filter(skill => skill.waiting).map(skill => skill.name), ['triage'], 'committed on this machine, not on origin\'s main yet')
    assert.equal(local.local, true, 'the folder\'s branch has it: an agent started from it does')
    assert.equal(local.remote, 'the remote', 'a folder on this machine has no host to name')
    assert.equal(local.branch, undefined)
    // On OpenAgent's own branch on the remote, as a send leaves it where no pull request could be opened.
    git('push', '-q', 'origin', 'HEAD:refs/heads/openagent/skills')
    assert.equal((await onProjectSkills(id))!.branch, 'openagent/skills')
    git('push', '-q', 'origin', 'main')
    const sent = (await onProjectSkills(id))!
    assert.deepEqual(flat(sent).filter(skill => skill.waiting), [])
    assert.equal(sent.branch, undefined, 'nothing waits: the branch is not told')
  } finally {
    await restore()
  }
})

test('a skill that reached the remote\'s branch elsewhere, a pull request merged on the git host, stops waiting here: this clone\'s copy of the branch is fetched first', async () => {
  const { dir, id, git, restore } = await project()
  try {
    git('init', '-q', '--bare', join(dir, '..', 'origin.git'))
    git('remote', 'add', 'origin', join(dir, '..', 'origin.git'))
    git('push', '-q', '-u', 'origin', 'main')
    const before = git('rev-parse', 'origin/main').trim()
    await writeFile(join(dir, '.git', 'x'), '')
    // The skill is committed and on the remote's main, and this clone's copy of that branch does not know yet.
    const { applyChange, commitChange } = await import('@openagt/init')
    await commitChange(dir, await applyChange(dir, { write: ['triage'] }))
    git('push', '-q', 'origin', 'main')
    git('update-ref', 'refs/remotes/origin/main', before)
    assert.equal(git('rev-parse', 'origin/main').trim(), before)
    assert.deepEqual(flat((await onProjectSkills(id))!).filter(skill => skill.waiting), [], 'fetched, and found there')
    assert.notEqual(git('rev-parse', 'origin/main').trim(), before)
  } finally {
    await restore()
  }
})

test('the scheduler\'s skill written switches the scheduler on for the project and starts it, deleted it stops it, and only names of the list are taken', async () => {
  const { dir, id, restore } = await project()
  try {
    assert.deepEqual(await sendChangeSkills(id, { write: ['scheduler'] }), { ok: true, written: ['scheduler'], removed: [], left: [], scheduler: 'on' })
    assert.match(await readFile(join(dir, '.openagent/hooks.yml'), 'utf8'), /scheduler start/)
    // The dashboard is open, so the scheduler runs from this moment, not from the next opening: its own line was run.
    assert.deepEqual(await sendChangeSkills(id, { write: ['scheduler'] }), { ok: true, written: ['scheduler'], removed: [], left: [] }, 'written again: nothing to switch')
    const running = await readState(dir)
    assert.ok(running.on && running.pid !== undefined && alive(running.pid), 'its process is ticking')
    assert.deepEqual(await sendChangeSkills(id, { remove: ['scheduler'] }), { ok: true, written: [], removed: ['scheduler'], left: [], scheduler: 'off' })
    assert.equal((await readState(dir)).on, false, 'and its skill deleted, it is stopped')
    for (let waited = 0; alive(running.pid!) && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(alive(running.pid!), false, 'its process ended')

    for (const change of [{ write: ['../../etc'] }, { remove: ['logs'] }, { write: ['tickets'] }, { write: 'tickets' }, null, 7, ['tickets']] as never[]) {
      assert.deepEqual(await sendChangeSkills(id, change), { ok: false, error: 'not a list of skills' }, JSON.stringify(change))
    }
    assert.equal(held((await onProjectSkills(id))!), 0, 'nothing of a refused change was written')
    assert.equal(await onProjectSkills('no-such-project'), null)
    assert.deepEqual(await sendChangeSkills('no-such-project', { write: ['tickets'] }), { ok: false, error: 'this project has no local path on this server' })
    assert.deepEqual(await sendProjectSkills('no-such-project'), { ok: false, error: 'this project has no local path on this server' })
  } finally {
    await stopScheduler(dir).catch(() => {})
    await restore()
  }
})

test('the remote is named for a person by its host, in any of git\'s spellings of the address', () => {
  assert.equal(hostName('https://github.com/suleimansh/test-project.git'), 'GitHub')
  assert.equal(hostName('git@gitlab.com:team/app.git'), 'GitLab')
  assert.equal(hostName('ssh://git@bitbucket.org:22/team/app.git'), 'Bitbucket')
  assert.equal(hostName('https://user:token@git.example.com/team/app'), 'git.example.com')
  assert.equal(hostName('/srv/git/app.git'), undefined)
  assert.equal(hostName('../origin.git'), undefined)
  assert.equal(hostName('file:///srv/git/app.git'), undefined)
  assert.equal(hostName(''), undefined)
})
