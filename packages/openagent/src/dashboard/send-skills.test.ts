import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyChange } from '@openagt/init'
import type { GitHostSource } from '../store/git-host.js'
import { sendSkills, SKILLS_BRANCH } from './send-skills.js'

// The skills sent where agents start from, against real git: a folder, and a bare repository as
// its remote, which a hook can make refuse a push to main the way a protected branch does.
async function project(): Promise<{ dir: string; origin: string; git: (...args: string[]) => string; remote: (...args: string[]) => string; done: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-send-skills-')))
  const dir = join(base, 'app')
  const origin = join(base, 'origin.git')
  await mkdir(dir)
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const remote = (...args: string[]): string => execFileSync('git', args, { cwd: origin, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'tester@example.com')
  git('config', 'user.name', 'tester')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(join(dir, 'README.md'), '# app\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  git('init', '-q', '--bare', '-b', 'main', origin)
  git('remote', 'add', 'origin', origin)
  git('push', '-q', '-u', 'origin', 'main')
  return { dir, origin, git, remote, done: () => rm(base, { recursive: true, force: true }) }
}

/** Files changed between two commits of the remote. */
const changed = (remote: (...args: string[]) => string, from: string, to: string): string[] => remote('diff', '--name-only', from, to).split('\n').filter(Boolean)

/** A git host that opens every pull request it is asked for as #7, and says which branches it was asked for. */
function host(asked: string[]): GitHostSource {
  return {
    open: async branch => {
      asked.push(branch)
      return { ok: true, request: { number: 7, url: 'https://example.com/pull/7' }, existing: false }
    },
    requests: async () => ({ ok: true, requests: [] }),
    merge: async () => ({ ok: false, error: 'not here' }),
    home: async () => undefined,
    me: async () => undefined,
  }
}

test('the folder on the default branch, past it by the skills alone: its own commit is pushed, so the folder and the remote stay one history', async () => {
  const { dir, git, remote, done } = await project()
  try {
    await applyChange(dir, { write: ['triage', 'plan'] })
    assert.deepEqual(await sendSkills(dir, ['triage', 'plan']), { ok: true, sent: 'pushed', branch: 'main' })
    assert.equal(remote('rev-parse', 'main').trim(), git('rev-parse', 'HEAD').trim())
    assert.equal(git('status', '--porcelain'), '')

    // A tick removed goes the same way: the skill is deleted on the remote too.
    await applyChange(dir, { remove: ['plan'] })
    const before = remote('rev-parse', 'main').trim()
    assert.deepEqual(await sendSkills(dir, ['plan']), { ok: true, sent: 'pushed', branch: 'main' })
    assert.deepEqual(changed(remote, before, 'main'), ['.agents/skills/plan/SKILL.md', '.claude/skills/plan'])
    assert.deepEqual(await sendSkills(dir, ['plan']), { ok: true, sent: 'pushed', branch: 'main' }, 'sent again, nothing new: nothing is pushed')
    assert.equal(remote('rev-parse', 'main').trim(), git('rev-parse', 'HEAD').trim())
  } finally {
    await done()
  }
})

test('other work of the person is never pushed: the skills go onto the remote\'s branch in a commit of their own, and the folder is left as it was', async () => {
  const { dir, git, remote, done } = await project()
  try {
    const before = remote('rev-parse', 'main').trim()
    await writeFile(join(dir, 'README.md'), '# app, edited and committed here only\n')
    git('commit', '-q', '-am', 'mine, not to push')
    await writeFile(join(dir, 'staged.txt'), 'staged, not committed\n')
    git('add', 'staged.txt')
    await applyChange(dir, { write: ['triage'] })
    assert.deepEqual(await sendSkills(dir, ['triage']), { ok: true, sent: 'pushed', branch: 'main' })
    assert.deepEqual(changed(remote, before, 'main'), ['.agents/skills/triage/SKILL.md', '.claude/skills/triage'])
    assert.equal(remote('log', '--format=%s', '-1', 'main').trim(), 'Update OpenAgent skills')
    assert.equal(git('log', '--format=%s', '-2').trim(), 'Update OpenAgent skills\nmine, not to push', 'the folder has its own commit of the skills')
    assert.equal(git('status', '--porcelain'), 'A  staged.txt\n', 'what was staged stays staged')

    // On a branch of its own the same: nothing of that branch goes.
    git('switch', '-q', '-c', 'feature')
    await applyChange(dir, { write: ['plan'] })
    const second = remote('rev-parse', 'main').trim()
    assert.deepEqual(await sendSkills(dir, ['plan']), { ok: true, sent: 'pushed', branch: 'main' })
    assert.deepEqual(changed(remote, second, 'main'), ['.agents/skills/plan/SKILL.md', '.claude/skills/plan'])
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature')
  } finally {
    await done()
  }
})

test('a default branch that takes no push: the skills go to a branch of OpenAgent\'s own and a pull request is opened for it; with no git host package, the branch alone', async () => {
  const { dir, origin, remote, done } = await project()
  try {
    const hook = join(origin, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && { echo "main is protected" >&2; exit 1; }; done\nexit 0\n')
    await chmod(hook, 0o755)
    const main = remote('rev-parse', 'main').trim()

    await applyChange(dir, { write: ['triage'] })
    const asked: string[] = []
    assert.deepEqual(await sendSkills(dir, ['triage'], { gitHost: async () => host(asked) }), { ok: true, sent: 'request', request: { number: 7, url: 'https://example.com/pull/7' } })
    assert.deepEqual(asked, [SKILLS_BRANCH])
    assert.equal(remote('rev-parse', 'main').trim(), main, 'main as it was')
    assert.deepEqual(changed(remote, main, SKILLS_BRANCH), ['.agents/skills/triage/SKILL.md', '.claude/skills/triage'])

    // A second send while the request is open holds both skills: the branch is written again from main.
    await applyChange(dir, { write: ['plan'] })
    assert.deepEqual(await sendSkills(dir, ['triage', 'plan'], { gitHost: async () => undefined }), { ok: true, sent: 'branch', branch: SKILLS_BRANCH })
    assert.deepEqual(changed(remote, main, SKILLS_BRANCH), ['.agents/skills/plan/SKILL.md', '.agents/skills/triage/SKILL.md', '.claude/skills/plan', '.claude/skills/triage'])
  } finally {
    await done()
  }
})

test('a remote that cannot be reached is said, after the commit in the folder', async () => {
  const { dir, git, done } = await project()
  try {
    git('remote', 'set-url', 'origin', join(dir, 'no-such-remote.git'))
    await applyChange(dir, { write: ['triage'] })
    const sent = await sendSkills(dir, ['triage'])
    assert.ok(!sent.ok && sent.error.startsWith('could not reach the remote: '), JSON.stringify(sent))
    assert.equal(git('log', '--format=%s', '-1').trim(), 'Update OpenAgent skills')
  } finally {
    await done()
  }
})
