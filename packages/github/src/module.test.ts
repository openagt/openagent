import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunOrder, type GithubFacts, type ProjectRef, type PullRequest, type RunContext, type RunFacts } from '@openagt/hooks'
import { fakeRun } from '@openagt/hooks/testing'
import { homedir } from 'node:os'
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

test("a run in a project on GitHub gets the module's skill, with its command; one elsewhere, or with no project, does not", async () => {
  const skills = githubModule({ onGithub: async dir => dir === SHOP.dir }).hooks['run.skills']!
  const [skill, ...more] = await skills({ project: SHOP })
  assert.deepEqual([skill?.name, skill?.command, more], ['github', 'github', []])
  assert.match(String(skill?.dir), /\/github\/$/, "the package's own folder, its SKILL.md in it")
  assert.deepEqual(await skills({ project: { ...SHOP, dir: '/projects/on-gitlab' } }), [])
  assert.deepEqual(await skills({}), [])
})

/** The account step, with the repositories that are on GitHub and the accounts OpenAgent has; what it was asked goes in `asked`. */
function accountStep(onGithub: string[], accounts: Record<string, string>, runs: string | undefined, asked: string[] = []) {
  return stepOf("work as the run's account", {
    onGithub: async dir => onGithub.includes(dir),
    workAs: async (dir, user, commitsIn) => {
      asked.push(`${dir} ${user ?? '(the account runs use)'}, commits in ${'project' in commitsIn ? commitsIn.project : `session ${commitsIn.session}`}`)
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
  assert.deepEqual(asked, ['/projects/shop octo-agent, commits in /projects/shop', '/projects/shop (the account runs use), commits in /projects/shop'])
})

test('a session with no project works as its account whatever its repos, and with none: the one picked, else the one runs use; a project that is not on GitHub works as no account', async () => {
  const asked: string[] = []
  const step = accountStep(['/repos/site'], { octo: 'octo-token', 'octo-agent': 'agent-token' }, 'octo', asked)
  const repos = [
    { name: 'notes', from: '/repos/notes' },
    { name: 'site', from: '/repos/site' },
  ]
  for (const session of [fakeRun({ options: { 'git-branches': { repos } } }), fakeRun({ options: { 'git-branches': { repos: [repos[0]!] } } }), fakeRun({})]) {
    await step.run(session)
    assert.deepEqual([session.env, session.facts.github], [{ GH_TOKEN: 'octo-token' }, { account: 'octo' }])
  }
  const picked = fakeRun({ options: { github: { account: 'octo-agent' } } })
  await step.run(picked)
  assert.deepEqual([picked.env, picked.facts.github], [{ GH_TOKEN: 'agent-token' }, { account: 'octo-agent' }])
  assert.deepEqual(asked, [...Array(3).fill(`${homedir()} (the account runs use), commits in session run-1`), `${homedir()} octo-agent, commits in session run-1`], 'its commits are in its own folder, where its repos are copied')
  const elsewhere = fakeRun({ project: { ...SHOP, dir: '/projects/elsewhere' } })
  await step.run(elsewhere)
  assert.deepEqual([elsewhere.env, elsewhere.facts.github], [{}, undefined])
  assert.equal(asked.length, 4)
})

test('a session with no project, no account picked, and none OpenAgent has goes on as no account: it may need none', async () => {
  const step = accountStep([], {}, undefined)
  const session = fakeRun({})
  await step.run(session)
  assert.deepEqual([session.env, session.facts.github], [{}, undefined])
})

test('a run that cannot work as its account on GitHub is refused, and says which: in a project, in a session with no project, and a project on no GitHub repository that picked one', async () => {
  const step = accountStep([SHOP.dir], { octo: 'octo-token' }, undefined)
  await assert.rejects(async () => step.run(fakeRun({ project: SHOP })), /^Error: OpenAgent has no GitHub account$/)
  await assert.rejects(async () => step.run(fakeRun({ project: SHOP, options: { github: { account: 'someone' } } })), /^Error: This session works as @someone on GitHub, and it cannot be used here: OpenAgent has no GitHub account someone$/)
  await assert.rejects(async () => step.run(fakeRun({ options: { github: { account: 'someone' } } })), /^Error: This session works as @someone on GitHub, and it cannot be used here: OpenAgent has no GitHub account someone$/)
  await assert.rejects(async () => step.run(fakeRun({ project: { ...SHOP, dir: '/projects/elsewhere' }, options: { github: { account: 'octo' } } })), /This session works as @octo on GitHub, and it works in no repository on GitHub/)
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
