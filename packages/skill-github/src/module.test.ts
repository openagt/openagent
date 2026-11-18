import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunOrder, type GithubFacts, type ProjectRef, type PullRequest, type RunContext, type RunFacts } from '@openagt/hooks'
import { fakeRun } from '@openagt/hooks/testing'
import { githubModule } from './module.js'

// github as a module: the pull request a run's branch has, read back into the run's facts.

const SHOP: ProjectRef = { id: 'shop', name: 'shop', dir: '/projects/shop' }
const PR_12: PullRequest = { number: 12, url: 'https://github.com/me/shop/pull/12' }
const PR_13: PullRequest = { number: 13, url: 'https://github.com/me/shop/pull/13' }

/** The module's one step, reading whatever request `now` says the branch has. */
function readBack(now: () => PullRequest | undefined, asked: string[] = []) {
  const [step] = githubModule({ requestOfBranch: async (dir, branch) => (asked.push(`${dir} ${branch}`), now()) }).hooks['run.step'] ?? []
  return step!
}

/** A run's github facts once the step read them back, from the facts it had; `null` for a run with no project. */
async function after(facts: RunFacts, now: () => PullRequest | undefined, project: ProjectRef | null = SHOP): Promise<GithubFacts | undefined> {
  const ctx: RunContext = fakeRun({ ...(project ? { project } : {}), facts })
  await readBack(now).run(ctx)
  return ctx.facts.github
}

test('it reads the pull request back after the branch is, before the record is saved', () => {
  const [step] = githubModule().hooks['run.step'] ?? []
  assert.deepEqual([step?.order, step?.name], [RunOrder.RECORD - 10, 'read the pull request back'])
})

test("the request of the branch the run's work is on; none asked for a run with no branch or no project", async () => {
  const asked: string[] = []
  const ctx = fakeRun({ project: SHOP, facts: { 'git-branches': { branch: 'agent-fix-it' } } })
  await readBack(() => PR_12, asked).run(ctx)
  assert.deepEqual(ctx.facts.github, { pr: PR_12 })
  assert.deepEqual(asked, ['/projects/shop agent-fix-it'])
  assert.equal(await after({}, () => PR_12), undefined)
  assert.equal(await after({ 'git-branches': { branch: 'agent-fix-it' } }, () => PR_12, null), undefined)
})

test('a run that opens another request keeps the one before among its earlier ones, once; work moved back takes its request back', async () => {
  const branch = { 'git-branches': { branch: 'agent-fix-it' } }
  assert.deepEqual(await after({ ...branch, github: { pr: PR_12 } }, () => PR_13), { pr: PR_13, earlierPrs: [PR_12] })
  assert.deepEqual(await after({ ...branch, github: { pr: PR_13, earlierPrs: [PR_12] } }, () => PR_13), { pr: PR_13, earlierPrs: [PR_12] }, 'the same request again: nothing new')
  assert.deepEqual(await after({ ...branch, github: { pr: PR_13, earlierPrs: [PR_12] } }, () => PR_12), { pr: PR_12, earlierPrs: [PR_13] })
  assert.deepEqual(await after({ ...branch, github: { pr: PR_12, earlierPrs: [PR_12] } }, () => PR_12), { pr: PR_12, earlierPrs: [] }, 'an emptied list is said too')
  assert.deepEqual(await after({ ...branch, github: { pr: PR_12 } }, () => undefined), { pr: PR_12 }, 'nothing read: the request the run had stays')
  assert.deepEqual(await after({ ...branch, github: { pr: PR_12 } }, () => { throw new Error('gh: not logged in') }), { pr: PR_12 }, 'GitHub could not say: the same')
})
