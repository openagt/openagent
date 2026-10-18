import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readState, updateState } from '@openagt/agent-scheduler'
import { removeSkill, setScheduler, writeSkill } from './apply.js'
import { carriedSkills } from './catalogue.js'
import { held, readProject, standingOf } from './project.js'
import { stamped } from './skill-file.js'
import { folder, gone, run } from './test-project.js'

test('how a project\'s text stands: the carried one, an older one, one changed by hand, one init did not write, one from a newer init', async () => {
  const skill = (await carriedSkills()).get('readability')!
  const other = skill.text.replace(/\n---\n/, '\n---\nA line the carried text does not have.\n')
  assert.notEqual(other, skill.text)
  assert.equal(standingOf(stamped(skill.text, skill.version), skill), 'current')
  assert.equal(standingOf(skill.text, skill), 'current', 'the same text with no stamp, as copied by hand')
  assert.equal(standingOf(stamped(skill.text, '0.0.1'), skill), 'current', 'an older stamp on the same text: nothing newer to take')
  assert.equal(standingOf(stamped(other, '0.0.1'), skill), 'newer', 'written by an older init, and the text has moved on')
  assert.equal(standingOf(stamped(other, skill.version), skill), 'changed', 'this version wrote it, and it is no longer what was written')
  assert.equal(standingOf(other, skill), 'own', 'no stamp: not init\'s')
  assert.equal(standingOf(stamped(other, '99.0.0'), skill), 'ahead', 'a newer init wrote it: this one has nothing to say')
  assert.equal(standingOf(stamped(skill.text, skill.version).replaceAll('\n', '\r\n'), skill), 'current', 'a checkout that made the line ends CRLF holds the same text')
})

test('a skill written is one tracked file and one relative link; written again it is the same; read back, the project has it', async () => {
  const root = await folder(true)
  try {
    assert.deepEqual(held(await readProject(root)), [])
    const touched = await writeSkill(root, 'maintenance')
    assert.deepEqual(touched, { paths: ['.agents/skills/maintenance/SKILL.md', '.claude/skills/maintenance'], left: [] })
    const skill = (await carriedSkills()).get('maintenance')!
    assert.equal(await readFile(join(root, '.agents/skills/maintenance/SKILL.md'), 'utf8'), stamped(skill.text, skill.version))
    assert.equal(await readlink(join(root, '.claude/skills/maintenance')), '../../.agents/skills/maintenance')
    assert.equal(await readFile(join(root, '.claude/skills/maintenance/SKILL.md'), 'utf8'), stamped(skill.text, skill.version), 'Claude Code reads the same file through the link')
    assert.deepEqual(await writeSkill(root, 'maintenance'), { paths: ['.agents/skills/maintenance/SKILL.md'], left: [] }, 'the link is already there')

    const state = await readProject(root)
    assert.deepEqual(held(state), ['maintenance'])
    assert.deepEqual(state.skills.find(s => s.name === 'maintenance'), { name: 'maintenance', standing: 'current', file: '.agents/skills/maintenance/SKILL.md' })
    assert.deepEqual({ git: state.git, activated: state.activated, scheduler: state.scheduler, remote: state.remote, github: state.github }, { git: true, activated: false, scheduler: false, remote: false, github: false })
    // Nothing but the two paths: no package.json, no install.
    assert.equal(await run(root, 'status', '--porcelain', '-uall'), '?? .agents/skills/maintenance/SKILL.md\n?? .claude/skills/maintenance\n')
  } finally {
    await gone(root)
  }
})

test('what is already at the link\'s place stays: a folder of the project\'s own, a link to somewhere else', async () => {
  const root = await folder(true)
  try {
    await mkdir(join(root, '.claude/skills/readability'), { recursive: true })
    await writeFile(join(root, '.claude/skills/readability/SKILL.md'), '---\nname: readability\n---\nOurs.\n')
    await symlink('../elsewhere', join(root, '.claude/skills/plan'))
    assert.deepEqual((await writeSkill(root, 'readability')).left, [{ path: '.claude/skills/readability', reason: 'not a link: Claude Code reads what is there' }])
    assert.deepEqual((await writeSkill(root, 'plan')).left, [{ path: '.claude/skills/plan', reason: 'a link to somewhere else' }])
    assert.equal(await readFile(join(root, '.claude/skills/readability/SKILL.md'), 'utf8'), '---\nname: readability\n---\nOurs.\n')
    assert.equal(await readlink(join(root, '.claude/skills/plan')), '../elsewhere')
  } finally {
    await gone(root)
  }
})

test('a project whose .claude/skills is itself a link to .agents/skills needs no link per skill, and nothing is reported as left', async () => {
  const root = await folder(true)
  try {
    await mkdir(join(root, '.agents/skills'), { recursive: true })
    await mkdir(join(root, '.claude'))
    await symlink('../.agents/skills', join(root, '.claude/skills'))
    assert.deepEqual(await writeSkill(root, 'maintenance'), { paths: ['.agents/skills/maintenance/SKILL.md'], left: [] })
    assert.match(await readFile(join(root, '.claude/skills/maintenance/SKILL.md'), 'utf8'), /^---\nname: maintenance\n/)
    assert.deepEqual(await removeSkill(root, 'maintenance'), { paths: ['.agents/skills/maintenance/SKILL.md'], left: [] })
    assert.deepEqual(held(await readProject(root)), [])
  } finally {
    await gone(root)
  }
})

test('a skill removed loses its text and its link; a file a person put beside the text keeps the folder; a text held only in Claude Code\'s folder goes too', async () => {
  const root = await folder(true)
  try {
    await writeSkill(root, 'ux')
    assert.deepEqual(await removeSkill(root, 'ux'), { paths: ['.claude/skills/ux', '.agents/skills/ux/SKILL.md'], left: [] })
    assert.deepEqual(held(await readProject(root)), [])
    assert.equal(await run(root, 'status', '--porcelain', '-uall'), '', 'no trace left')
    assert.deepEqual(await removeSkill(root, 'ux'), { paths: [], left: [] }, 'asked again: nothing there')

    await writeSkill(root, 'plan')
    await writeFile(join(root, '.agents/skills/plan/notes.md'), 'mine\n')
    assert.deepEqual(await removeSkill(root, 'plan'), { paths: ['.claude/skills/plan', '.agents/skills/plan/SKILL.md'], left: [{ path: '.agents/skills/plan', reason: 'it holds other files' }] })
    assert.equal(await readFile(join(root, '.agents/skills/plan/notes.md'), 'utf8'), 'mine\n')

    await mkdir(join(root, '.claude/skills/triage'), { recursive: true })
    await writeFile(join(root, '.claude/skills/triage/SKILL.md'), '---\nname: triage\n---\nOurs.\n')
    assert.deepEqual(held(await readProject(root)), ['triage'])
    assert.deepEqual(await removeSkill(root, 'triage'), { paths: ['.claude/skills/triage/SKILL.md'], left: [] })
    assert.deepEqual(held(await readProject(root)), [])
  } finally {
    await gone(root)
  }
})

test('the scheduler switched on makes a folder a project first, as a dashboard does, and writes its two lines; switched off it takes them back', async () => {
  const root = await folder(false)
  try {
    assert.deepEqual(await setScheduler(root, true), { ok: true, changed: true, madeRepository: true })
    assert.equal((await run(root, 'log', '--format=%s')).trim(), '[OpenAgent] first commit')
    assert.equal(await readFile(join(root, '.openagent/hooks.yml'), 'utf8'), 'open:\n  - agent-scheduler start\nclose:\n  - agent-scheduler stop --unless-keep-alive\n')
    assert.equal(await run(root, 'status', '--porcelain', '-uall'), '', 'the hooks file is outside git')
    const on = await readProject(root)
    assert.deepEqual({ scheduler: on.scheduler, activated: on.activated, git: on.git }, { scheduler: true, activated: true, git: true })
    assert.deepEqual(await setScheduler(root, true), { ok: true, changed: false }, 'already on')

    // A scheduler that is running is stopped with it: the line that would stop it at the dashboard's close just went.
    const running = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const ended = new Promise<string | null>(resolve => running.on('exit', (_code, signal) => resolve(signal)))
    await updateState(root, state => ({ ...state, on: true, pid: running.pid!, startedAt: new Date().toISOString() }))
    assert.deepEqual(await setScheduler(root, false), { ok: true, changed: true })
    assert.equal(await ended, 'SIGINT', 'the running scheduler was asked to stop')
    assert.equal((await readState(root)).on, false)
    assert.equal((await readProject(root)).scheduler, false)
    assert.deepEqual(await setScheduler(root, false), { ok: true, changed: false })

    // A file that cannot be read is said, and not written over.
    await writeFile(join(root, '.openagent/hooks.yml'), 'open: [')
    const failed = await setScheduler(root, true)
    assert.ok(!failed.ok && failed.error.includes('hooks.yml'))
    await rm(join(root, '.openagent/hooks.yml'))
  } finally {
    await gone(root)
  }
})
