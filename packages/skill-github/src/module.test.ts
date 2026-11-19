import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunOrder, type GithubFacts, type ProjectRef, type PullRequest, type RunContext, type RunFacts } from '@openagt/hooks'
import { fakeRun } from '@openagt/hooks/testing'
import { githubModule, type GithubDeps } from './module.js'

// github as a module: the account a run works as, and the pull request a run's branch has, read
// back into the run's facts.

const SHOP: ProjectRef = { id: 'shop', name: 'shop', dir: '/projects/shop' }
const PR_12: PullRequest = { number: 12, url: 'https://github.com/me/shop/pull/12' }
const PR_13: PullRequest = { number: 13, url: 'https://github.com/me/shop/pull/13' }

/** The module's step of that name, with `deps`. */
function stepOf(name: string, deps: GithubDeps = {}) {
  const step = (githubModule(deps).hooks['run.step'] ?? []).find(one => one.name === name)
  assert.ok(step, `a step "${name}"`)
  return step
}

/** The module's read-back step, reading whatever request `now` says the branch has. */
function readBack(now: () => PullRequest | undefined, asked: string[] = []) {
  return stepOf('read the pull request back', { requestOfBranch: async (dir, branch) => (asked.push(`${dir} ${branch}`), now()) })
}

/** A run's github facts once the step read them back, from the facts it had; `null` for a run with no project. */
async function after(facts: RunFacts, now: () => PullRequest | undefined, project: ProjectRef | null = SHOP): Promise<GithubFacts | undefined> {
  const ctx: RunContext = fakeRun({ ...(project ? { project } : {}), facts })
  await readBack(now).run(ctx)
  return ctx.facts.github
}

test("it works as the run's account first of all, and reads the pull request back after the branch is, before the record is saved", () => {
  assert.deepEqual(
    (githubModule().hooks['run.step'] ?? []).map(step => [step.order, step.name]),
    [
      [RunOrder.ACCOUNTS, "work as the run's account"],
      [RunOrder.RECORD - 10, 'read the pull request back'],
    ],
  )
})

/** The account step, with the repositories that are on GitHub and the accounts OpenAgent has; what it was asked goes in `asked`. */
function accountStep(onGithub: string[], accounts: Record<string, string>, runs: string | undefined, asked: string[] = []) {
  return stepOf("work as the run's account", {
    onGithub: async dir => onGithub.includes(dir),
    workAs: async (dir, user) => {
      asked.push(`${dir} ${user ?? '(the account runs use)'}`)
      const login = user ?? runs
      if (login === undefined || accounts[login] === undefined) throw new Error(`OpenAgent has no GitHub account${user !== undefined ? ` ${user}` : ''}`)
      return { login, env: { GH_TOKEN: accounts[login] } }
    },
  })
}

test("a run on GitHub works as the account picked for it, else the one runs use: its environment is the run's, and its login is kept", async () => {
  const asked: string[] = []
  const step = accountStep([SHOP.dir], { octo: 'octo-token', 'octo-agent': 'agent-token' }, 'octo', asked)
  const picked = fakeRun({ project: SHOP, options: { github: { account: 'octo-agent' } } })
  await step.run(picked)
  assert.deepEqual(picked.env, { GH_TOKEN: 'agent-token' })
  assert.deepEqual(picked.facts.github, { account: 'octo-agent' })
  const unpicked = fakeRun({ project: SHOP, facts: { github: { pr: PR_12 } } })
  await step.run(unpicked)
  assert.deepEqual(unpicked.env, { GH_TOKEN: 'octo-token' })
  assert.deepEqual(unpicked.facts.github, { pr: PR_12, account: 'octo' }, 'the facts it had are kept')
  assert.deepEqual(asked, ['/projects/shop octo-agent', '/projects/shop (the account runs use)'])
})

test('a session with no project works as the account on the first of its repos that is on GitHub; one on none works as no account', async () => {
  const asked: string[] = []
  const step = accountStep(['/repos/site', '/repos/app'], { octo: 'octo-token' }, 'octo', asked)
  const repos = [
    { name: 'notes', from: '/repos/notes' },
    { name: 'site', from: '/repos/site' },
    { name: 'app', from: '/repos/app' },
  ]
  const session = fakeRun({ options: { 'git-branches': { repos } } })
  await step.run(session)
  assert.deepEqual([session.env, session.facts.github], [{ GH_TOKEN: 'octo-token' }, { account: 'octo' }])
  assert.deepEqual(asked, ['/repos/site (the account runs use)'])
  for (const ctx of [fakeRun({}), fakeRun({ options: { 'git-branches': { repos: [repos[0]!] } } }), fakeRun({ project: { ...SHOP, dir: '/projects/elsewhere' } })]) {
    await step.run(ctx)
    assert.deepEqual([ctx.env, ctx.facts.github], [{}, undefined])
  }
  assert.equal(asked.length, 1)
})

test('a run that cannot work as its account on GitHub is refused, and says which; one picked an account and on no GitHub repository too', async () => {
  const step = accountStep([SHOP.dir], { octo: 'octo-token' }, undefined)
  await assert.rejects(async () => step.run(fakeRun({ project: SHOP })), /^Error: OpenAgent has no GitHub account$/)
  await assert.rejects(async () => step.run(fakeRun({ project: SHOP, options: { github: { account: 'someone' } } })), /^Error: This session works as @someone on GitHub, and it cannot be used here: OpenAgent has no GitHub account someone$/)
  await assert.rejects(async () => step.run(fakeRun({ options: { github: { account: 'octo' } } })), /This session works as @octo on GitHub, and it works in no repository on GitHub/)
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
