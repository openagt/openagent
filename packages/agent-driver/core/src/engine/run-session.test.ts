import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { FakeDriver } from '../fake.js'
import { findRun, readDiary } from '../record-store.js'
import type { Driver } from '@openagt/hooks'
import { personalFolder, sessionFolder, sessionsHome, SESSIONS_DIR } from '@openagt/agent-data'
import { readLiveCard } from './live-card.js'
import { resumeRun, runCommand } from './run.js'
import { addedLine, PUBLISH_LINES } from './session.js'
import { markerCard, writeMarker } from './records.js'
import { sweep } from './sweep.js'
import { runCli } from './cli.js'
import { runArgs } from './runner.js'
import { SESSION_FOLDER_STAYS, sessionRepos, worktreePath } from '@openagt/git-branches'
import { copiesLine } from '@openagt/projects/module'
import { NOW, testModules } from './run-test-support.js'
import { git, removeRepo, testRepo } from './test-repo.js'

// A session with no project: a run in the sessions home works in a folder of its own there, with
// no git, and its record is kept with the other sessions' in the personal folder.

const ID = '2026-09-16T14-01-00-000Z'

/** An agent that writes a file where it works and says so. */
function writingDriver(seen: { cwd?: string } = {}): Driver {
  return {
    id: 'fake',
    start: async opts => {
      seen.cwd = opts.cwd
      await writeFile(join(opts.cwd, 'notes.md'), 'what I found\n')
      return new FakeDriver({ respond: prompt => ({ text: `Done: ${prompt}`, usage: { costUsd: 0.25, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 } }), sessionId: 's-1' }).start(opts)
    },
  }
}

async function freshHome(): Promise<string> {
  const home = sessionsHome()
  await rm(home, { recursive: true, force: true })
  await rm(join(personalFolder(), SESSIONS_DIR), { recursive: true, force: true })
  await mkdir(home, { recursive: true })
  return home
}

test('a run in the sessions home works in its own folder, keeps it, and is recorded with the sessions', async () => {
  const home = await freshHome()
  const skill = join(home, '..', 'a-skill')
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: a-skill\n---\n')
  const seen: { cwd?: string } = {}
  const outcome = await runCommand(home, { prompt: 'Read the news', driver: writingDriver(seen), host: 'this-box', pid: 4242, now: () => NOW, modules: testModules({ also: [{ name: 'a-module', hooks: { 'run.skills': () => [{ name: 'a-skill', dir: skill }] } }] }) })

  assert.equal(seen.cwd, sessionFolder(home, ID), 'the agent works in the session folder')
  assert.equal(outcome.status, 'done')
  assert.equal(outcome.branch, undefined, 'a session folder has no branch')
  assert.deepEqual(outcome.checkout, { reclaimed: false, reason: SESSION_FOLDER_STAYS })
  assert.equal(await readFile(join(sessionFolder(home, ID), 'notes.md'), 'utf8'), 'what I found\n', 'what the agent made stays')
  assert.ok((await lstat(join(sessionFolder(home, ID), '.claude/skills/a-skill'))).isSymbolicLink(), "the run's skills are linked in")

  const card = await findRun(home, ID)
  assert.equal(card?.status, 'done')
  assert.equal(card?.branch, undefined)
  assert.equal(card?.intent, 'Read the news')
  const people = join(personalFolder(), SESSIONS_DIR, 'agents')
  const [person] = await readdir(people)
  assert.deepEqual((await readdir(join(people, person!))).sort(), [`${ID}.json`, `${ID}.jsonl`], "the record is in the personal folder's sessions directory")
})

test('a session goes on in the same folder when it is resumed', async () => {
  const home = await freshHome()
  await runCommand(home, { prompt: 'Read the news', driver: writingDriver(), host: 'this-box', pid: 4242, now: () => NOW, modules: testModules() })
  const seen: { cwd?: string } = {}
  const outcome = await resumeRun(home, { id: ID, text: 'And the weather', driver: writingDriver(seen), host: 'this-box', pid: 4243, modules: testModules() })
  assert.equal(outcome.status, 'done')
  assert.equal(seen.cwd, sessionFolder(home, ID))
  assert.equal((await findRun(home, ID))?.status, 'done')
})

test('the sweep closes a session whose process died, and leaves its folder', async () => {
  const home = await freshHome()
  const folder = sessionFolder(home, ID)
  await mkdir(join(folder, '.openagent'), { recursive: true })
  const card = markerCard({ id: ID, startedAt: NOW.toISOString(), prompt: 'Read the news', driver: 'fake', mark: { host: 'this-box', pid: 999_999 } })
  await writeMarker(home, card)
  await writeFile(join(folder, '.openagent', `${ID}.json`), JSON.stringify({ ...card, status: 'running' }))
  const swept = await sweep(home, { host: 'this-box', isAlive: () => false, now: () => NOW })
  assert.deepEqual(swept.recorded, [{ id: ID, status: 'failed' }])
  assert.deepEqual(swept.kept, [{ id: ID, reason: SESSION_FOLDER_STAYS }])
  assert.equal((await findRun(home, ID))?.status, 'failed')
  assert.equal((await readLiveCard(folder, ID))?.status, 'failed')

  // Swept again: the session's record says how it ended, so it is left alone.
  assert.deepEqual(await sweep(home, { host: 'this-box', isAlive: () => false, now: () => NOW }), { recorded: [], reclaimed: [], kept: [] })
})

test('a run in the sessions home takes no flag about a branch, and a level only with repos to publish', async () => {
  const home = await freshHome()
  const err: string[] = []
  assert.equal(await runCli(['run', '--base', 'main', 'Read the news'], { cwd: home, stdout: () => {}, stderr: line => err.push(line) }), 2)
  assert.match(err[0] ?? '', /--base is for a run in a project: a session with no project has no git/)
  err.length = 0
  assert.equal(await runCli(['run', '--publish', 'pr', 'Read the news'], { cwd: home, stdout: () => {}, stderr: line => err.push(line) }), 2)
  assert.match(err[0] ?? '', /--publish needs --repos in a session with no project/)
})

test('a session with repos and a level: its agent is told to take each copy it changed that far; one with no repo is told nothing', async () => {
  const home = await freshHome()
  const repo = await repoWithoutOrigin()
  try {
    const repos = await sessionRepos([repo])
    const outcome = await runCommand(home, { prompt: 'Fix it', publish: 'pr', driver: writingDriver(), host: 'this-box', pid: 4242, now: () => NOW, modules: testModules(), repos })
    assert.equal(outcome.status, 'done')
    const copy = join(sessionFolder(home, ID), 'repo')
    const line = `${PUBLISH_LINES.pr} That is for each copied repo you changed, on its own branch there: ${copy}.`
    assert.equal(addedLine('pr', undefined, { folders: [copy], alone: true }), line)
    assert.equal((await readDiary(home, ID))?.find(entry => entry.kind === 'start')?.['added'], line)
    assert.equal(addedLine('pr', undefined, { folders: [], alone: true }), undefined, 'no project and no repo: nothing to publish')
    assert.equal(addedLine('commit', undefined, { folders: ['/s/api', '/s/site'], alone: false }), `${PUBLISH_LINES.commit} Do the same in each copied repo you changed, on its own branch there: /s/api, /s/site.`, "in a project: the project's sentence, then the copies")
    assert.equal(addedLine('commit', undefined, { folders: [], alone: false }), PUBLISH_LINES.commit, 'a project with no copy: as before')
  } finally {
    await removeRepo(repo)
  }
})

/** A repo with no remote: one commit on `main`. */
async function repoWithoutOrigin(): Promise<string> {
  const repo = await testRepo()
  await git(['remote', 'remove', 'origin'], repo)
  return repo
}

const branchOf = async (folder: string): Promise<string> => (await git(['branch', '--show-current'], folder)).trim()
const originOf = async (folder: string): Promise<string | undefined> => (await git(['remote', 'get-url', 'origin'], folder).catch(() => '')).trim() || undefined

test('a session with repos has a copy of each in its folder, on its own branch, with the origin the repo has', async () => {
  const home = await freshHome()
  const withOrigin = await testRepo()
  const withNone = await repoWithoutOrigin()
  try {
    const repos = await sessionRepos([withOrigin, withNone])
    assert.deepEqual(repos, [{ name: 'repo', from: withOrigin }, { name: 'repo-2', from: withNone }], 'two folders of one name are told apart')
    const seen: { cwd?: string } = {}
    const outcome = await runCommand(home, { prompt: 'Compare them', driver: writingDriver(seen), host: 'this-box', pid: 4242, now: () => NOW, modules: testModules(), repos })
    assert.equal(outcome.status, 'done')
    const folder = sessionFolder(home, ID)
    assert.equal(seen.cwd, folder, 'the agent starts in the session folder, the repos in it')
    for (const name of ['repo', 'repo-2']) {
      assert.equal(await readFile(join(folder, name, 'README.md'), 'utf8'), '# t\n', `${name} is a copy of the repo`)
      assert.equal(await branchOf(join(folder, name)), `agent-${ID}`)
    }
    assert.equal(await originOf(join(folder, 'repo')), await originOf(withOrigin), "the copy's origin is the repo's own")
    assert.equal(await originOf(join(folder, 'repo-2')), undefined, 'a repo with no origin gives its copy none: nothing goes back into its folder')
    assert.equal(await branchOf(withOrigin), 'main', "the repo's own folder is left as it was")
    assert.equal((await git(['branch', '--list', `agent-${ID}`], withOrigin)).trim(), '', 'no branch is made in the repo')
    assert.equal((await git(['worktree', 'list'], withOrigin)).trim().split('\n').length, 1, 'no worktree of the repo')
    assert.deepEqual((await findRun(home, ID))?.caller?.['repos'], repos, 'the record names the repos')
  } finally {
    await removeRepo(withOrigin)
    await removeRepo(withNone)
  }
})

test('a resumed session keeps its copies as the agent left them, and makes again one that is gone', async () => {
  const home = await freshHome()
  const one = await testRepo()
  const two = await repoWithoutOrigin()
  try {
    const repos = await sessionRepos([one, two])
    await runCommand(home, { prompt: 'Start', driver: writingDriver(), host: 'this-box', pid: 4242, now: () => NOW, modules: testModules(), repos })
    const folder = sessionFolder(home, ID)
    await writeFile(join(folder, 'repo', 'work.txt'), 'the agent was here\n')
    await rm(join(folder, 'repo-2'), { recursive: true, force: true })
    const outcome = await resumeRun(home, { id: ID, text: 'Go on', driver: writingDriver(), host: 'this-box', pid: 4243, modules: testModules() })
    assert.equal(outcome.status, 'done')
    assert.equal(await readFile(join(folder, 'repo', 'work.txt'), 'utf8'), 'the agent was here\n', 'a copy that stayed is kept as it is')
    assert.equal(await branchOf(join(folder, 'repo-2')), `agent-${ID}`, 'a copy that is gone is made again')
    assert.deepEqual((await findRun(home, ID))?.caller?.['repos'], repos, 'the resumed record still names them')
  } finally {
    await removeRepo(one)
    await removeRepo(two)
  }
})

test('a run in a project with repos works in its checkout of the project, has a copy of each repo in a session folder beside it, and its agent is told where they are, once', async () => {
  const home = await freshHome()
  const project = await testRepo()
  const other = await repoWithoutOrigin()
  try {
    const repos = await sessionRepos([other])
    const cwds: string[] = []
    // The agent leaves a file in its copy on its first turn: a copy it never touched would go with the run.
    const driver = (): Driver => ({
      id: 'fake',
      start: async opts => {
        cwds.push(opts.cwd)
        const work = join(sessionFolder(home, basename(opts.cwd).replace(/^agent-/, '')), 'repo', 'work.txt')
        if (cwds.length === 1) await writeFile(work, 'the agent was here\n')
        return new FakeDriver({ turns: [{ text: 'Done.' }], sessionId: 's-1' }).start(opts)
      },
    })
    const first = await runCommand(project, { prompt: 'Compare them', driver: driver(), host: 'this-box', pid: 4242, now: () => NOW, modules: testModules(), repos })
    assert.equal(first.status, 'done')
    assert.equal(cwds[0], worktreePath(project, first.id), 'the agent works in its checkout of the project')
    const folder = sessionFolder(home, first.id)
    const copy = join(folder, 'repo')
    assert.equal(await readFile(join(copy, 'README.md'), 'utf8'), '# t\n', 'the repo is a copy in the session folder')
    assert.equal(await branchOf(copy), `agent-${first.id}`)
    assert.equal(await branchOf(other), 'main', "the repo's own folder is left as it was")
    assert.equal((await git(['branch', '--list', `agent-${first.id}`], other)).trim(), '', 'no branch is made in the repo')
    assert.deepEqual((await findRun(project, first.id))?.caller?.['repos'], repos, 'the record names the repos')
    const told = copiesLine(folder, `agent-${first.id}`, repos)
    assert.ok(told.includes(`${copy} (copied from ${other})`), 'the line names the copy and where it came from')
    assert.equal((await readDiary(project, first.id))?.find(line => line.kind === 'start')?.['attached'], told, 'the agent is handed where the copies are, with its prompt')

    const resumed = await resumeRun(project, { id: first.id, text: 'Go on', driver: driver(), host: 'this-box', pid: 4243, modules: testModules() })
    assert.equal(resumed.status, 'done')
    assert.equal(await readFile(join(copy, 'work.txt'), 'utf8'), 'the agent was here\n', 'a resumed run keeps its copy as it is')
    assert.deepEqual((await readDiary(project, first.id))?.filter(line => line.kind === 'start').map(line => line['attached']), [told, undefined], 'and is not told again of a copy it has')
  } finally {
    await removeRepo(project)
    await removeRepo(other)
  }
})

test('repos are given by folders in them, each once, and a folder that is no repo is refused', async () => {
  const repo = await testRepo()
  try {
    await mkdir(join(repo, 'src'), { recursive: true })
    assert.deepEqual(await sessionRepos([join(repo, 'src'), repo]), [{ name: 'repo', from: repo }])
    const home = await freshHome()
    await assert.rejects(sessionRepos([home]), new RegExp(`${home} is not a git repository`))
  } finally {
    await removeRepo(repo)
  }
})

test('--repos is read one folder per line, and handed on to the run\'s process; a resume takes none', async () => {
  const home = await freshHome()
  const repo = await testRepo()
  try {
    const out: string[] = []
    const err: string[] = []
    assert.equal(await runCli(['run', '--repos', home, 'Read'], { cwd: home, stdout: line => out.push(line), stderr: line => err.push(line) }), 1)
    assert.match(err.at(-1) ?? '', /is not a git repository/)
    assert.equal(JSON.parse(out[0]!).reason, 'not-a-repo')
    err.length = 0
    assert.equal(await runCli(['run', '--resume', ID, '--repos', repo, 'More'], { cwd: home, stdout: () => {}, stderr: line => err.push(line) }), 2)
    assert.match(err[0] ?? '', /--resume takes no --repos/)
    const repos = [{ name: 'repo', from: repo }, { name: 'other', from: '/x/other' }]
    assert.ok(runArgs({ id: ID, prompt: 'Read', repos }).includes(`--repos=${repo}\n/x/other`))
  } finally {
    await removeRepo(repo)
  }
})
