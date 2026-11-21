import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHooks, RunOrder, type DistributionEntry, type ProjectRef, type PullRequest, type RunOutcome } from '@openagt/hooks'
import { fakeRun, memoryStore } from '@openagt/hooks/testing'
import { NOTIFY_COMMAND, notificationsCommand } from './module.js'

// The plugin's two steps, as a run goes through them: the pull request noted as the run starts,
// the person's command at its end.

const PR = { number: 12, url: 'https://x/pull/12' }

test('a plugin kept per computer, off until a person switches it on: its steps are a run\'s only once it is', async () => {
  const module = notificationsCommand()
  assert.deepEqual(module.plugin, { scope: 'computer' })
  // Its Enabled row is read where the store keeps this computer's settings.
  const store: DistributionEntry = { module: { name: 'test-store', hooks: { 'store.backend': memoryStore() } } }
  assert.deepEqual(await createHooks([store, { module }]).steps({ options: {} }), [])
  const on = await createHooks([store, { module, on: true }]).steps({ options: {} })
  assert.deepEqual(
    on.map(step => [step.order, step.name]),
    [
      [RunOrder.CLONE, 'note the pull request the run starts with'],
      [RunOrder.NOTIFY, "run the person's command"],
    ],
  )
})

/** A run through the plugin's steps, from the pull request it starts with to how it ends; what the command wrote. */
async function run(end: { outcome: RunOutcome; before?: PullRequest; after?: PullRequest; command?: string; project?: false }): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'notifications-command-')))
  const out = join(dir, 'out.txt')
  try {
    const project: ProjectRef = { id: 'p1', name: 'shop', dir }
    const ctx = fakeRun({ prompt: '/work-queue', ...(end.project === false ? {} : { project }), facts: end.before ? { github: { pr: end.before } } : {} })
    await ctx.settings.set(NOTIFY_COMMAND, end.command ?? `printf '%s|%s|%s|%s' "$PWD" "$STATUS" "$PR_URL" "$MESSAGE" > '${out}'`)
    const [start, notify] = notificationsCommand().hooks['run.step']!
    await start!.run(ctx)
    ctx.facts.github = end.after ? { pr: end.after } : {}
    ctx.outcome = end.outcome
    await notify!.run(ctx)
    return (await readFile(out, 'utf8').catch(() => '')).replace(dir, '<project>')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("a run that ends waiting runs the command in the project's folder, saying what it asks", async () => {
  assert.equal(await run({ outcome: { status: 'waiting', question: 'Ship it?' } }), '<project>|waiting||shop: "/work-queue" is waiting for you: Ship it?')
})

test('a run that ends done runs it only with a pull request it did not start with', async () => {
  assert.equal(await run({ outcome: { status: 'done' }, after: PR }), '<project>|done|https://x/pull/12|shop: "/work-queue" opened a pull request: https://x/pull/12')
  assert.equal(await run({ outcome: { status: 'done' }, before: PR, after: PR }), '', 'the one it started with is no news')
  assert.equal(await run({ outcome: { status: 'done' } }), '')
  assert.equal(await run({ outcome: { status: 'failed', error: 'boom' }, after: PR }), '', 'a failed run is left to whoever looks at the runs')
})

test('no command saved, nothing runs', async () => {
  assert.equal(await run({ outcome: { status: 'waiting', question: 'Ship it?' }, command: '' }), '')
})

test("a session with no project runs it in the person's home folder, named a session", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notifications-command-session-'))
  try {
    const out = join(dir, 'out.txt')
    await run({ outcome: { status: 'waiting', question: 'Ship it?' }, project: false, command: `printf '%s|%s' "$PWD" "$MESSAGE" > '${out}'` })
    assert.equal(await readFile(out, 'utf8'), `${homedir()}|A session: "/work-queue" is waiting for you: Ship it?`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a command that fails throws, for the run to say on its log', async () => {
  await assert.rejects(run({ outcome: { status: 'waiting', question: 'Ship it?' }, command: 'exit 4' }), { message: 'it exited 4' })
})
