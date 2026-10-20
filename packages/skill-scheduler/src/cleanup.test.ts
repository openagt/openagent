import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanup } from './cleanup.js'
import { runCli } from './cli.js'
import { SCHEDULER_LOG, STATE_DIR } from './names.js'
import { DEFAULT_STATE, statePath, writeState } from './state.js'
import { git, removeRepo, testRepo } from './test-repo.js'

// `cleanup` on a real repository with a real remote: the tool's own files go, and nothing else
// in the project or on the remote changes.

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const excludeOf = (repo: string): Promise<string> => readFile(join(repo, '.git', 'info', 'exclude'), 'utf8').catch(() => '')

/** What a clean-up must leave as it found it: the remote's branches, every local branch, the working tree. */
async function outside(repo: string): Promise<string> {
  return [await git(['ls-remote', 'origin'], repo), await git(['for-each-ref', 'refs/heads'], repo), await git(['status', '--porcelain'], repo)].join('---\n')
}

/** A scheduler that ran here and stopped: its state written, its log left. */
async function ran(repo: string, pid?: number): Promise<void> {
  await writeState(repo, { ...DEFAULT_STATE, on: true, ...(pid === undefined ? {} : { pid }) })
  await writeFile(join(repo, STATE_DIR, SCHEDULER_LOG), '[scheduler] tick\n')
}

test('the state, the log, the directory and the rule hiding it go; the project, its skills and the remote stay as they were', async () => {
  const repo = await testRepo()
  try {
    const before = await outside(repo)
    await ran(repo)
    assert.match(await excludeOf(repo), /^\/\.scheduler$/m)

    assert.deepEqual(await cleanup(repo), { ok: true, removed: [STATE_DIR], kept: [] })
    assert.equal(await exists(join(repo, STATE_DIR)), false)
    assert.doesNotMatch(await excludeOf(repo), /scheduler/)
    assert.equal(await outside(repo), before)

    assert.deepEqual(await cleanup(repo), { ok: true, removed: [], kept: [] }, 'a second pass finds nothing')
  } finally {
    await removeRepo(repo)
  }
})

test('while the scheduler runs the clean-up is refused and nothing goes; once it is dead everything does', async () => {
  const repo = await testRepo()
  try {
    await ran(repo, 4242)
    assert.deepEqual(await cleanup(repo, { isAlive: pid => pid === 4242 }), { ok: false, reason: 'running', pid: 4242 })
    assert.equal(await exists(statePath(repo)), true)
    assert.equal(await exists(join(repo, STATE_DIR, SCHEDULER_LOG)), true)

    assert.deepEqual(await cleanup(repo, { isAlive: () => false }), { ok: true, removed: [STATE_DIR], kept: [] })

    // A pid that is no process's is never probed: the probe answers yes for 0.
    await ran(repo, 0)
    assert.deepEqual(await cleanup(repo, { isAlive: () => true }), { ok: true, removed: [STATE_DIR], kept: [] })
  } finally {
    await removeRepo(repo)
  }
})

test('a file of the person\'s own in the directory stays with it; the tool\'s two files are named as they go', async () => {
  const repo = await testRepo()
  try {
    await ran(repo)
    await writeFile(join(repo, STATE_DIR, 'notes.txt'), 'mine\n')
    assert.deepEqual(await cleanup(repo), {
      ok: true,
      removed: [`${STATE_DIR}/${SCHEDULER_LOG}`, `${STATE_DIR}/state.json`],
      kept: [{ path: `${STATE_DIR}/notes.txt`, reason: 'not made by scheduler' }],
    })
    assert.match(await excludeOf(repo), /^\/\.scheduler$/m)
  } finally {
    await removeRepo(repo)
  }
})

test('the automations a person keeps on this machine stay, with the directory and its rule: they are the person\'s own writing and exist nowhere else, and the answer says so', async () => {
  const repo = await testRepo()
  try {
    await ran(repo)
    await mkdir(join(repo, STATE_DIR, 'automations'))
    await writeFile(join(repo, STATE_DIR, 'automations', 'answer-comments.md'), '---\nschedule:\n  every: 1d\n---\nAnswer.\n')
    assert.deepEqual(await cleanup(repo), {
      ok: true,
      removed: [`${STATE_DIR}/${SCHEDULER_LOG}`, `${STATE_DIR}/state.json`],
      kept: [{ path: `${STATE_DIR}/automations`, reason: 'your own automations, kept on this machine alone: remove the folder by hand to delete them' }],
    })
    assert.equal(await readFile(join(repo, STATE_DIR, 'automations', 'answer-comments.md'), 'utf8'), '---\nschedule:\n  every: 1d\n---\nAnswer.\n')
    assert.match(await excludeOf(repo), /^\/\.scheduler$/m)
    // The person deletes their automations by hand: the folder is empty, and now everything goes.
    await rm(join(repo, STATE_DIR, 'automations', 'answer-comments.md'))
    assert.deepEqual(await cleanup(repo), { ok: true, removed: [STATE_DIR], kept: [] })
    assert.equal(await exists(join(repo, STATE_DIR)), false)
    assert.doesNotMatch(await excludeOf(repo), /scheduler/)
  } finally {
    await removeRepo(repo)
  }
})

test('the command: refused with the pid while the scheduler runs, and the JSON of what went once it does not', async () => {
  const repo = await testRepo()
  try {
    const run = async () => {
      const out: string[] = []
      const err: string[] = []
      const code = await runCli(['cleanup'], { cwd: repo, stdout: line => out.push(line), stderr: line => err.push(line) })
      return { code, out: JSON.parse(out.join('\n')) as unknown, err: err.join('\n') }
    }
    // This test's own process is alive: a state naming it reads as a scheduler that runs.
    await ran(repo, process.pid)
    assert.deepEqual(await run(), { code: 1, out: { ok: false, reason: 'running', pid: process.pid }, err: `the scheduler is running here (pid ${process.pid}): stop it first with npx @openagt/skill-scheduler@0.1 stop` })
    await ran(repo)
    assert.deepEqual(await run(), { code: 0, out: { ok: true, removed: [STATE_DIR], kept: [] }, err: '' })
  } finally {
    await removeRepo(repo)
  }
})
