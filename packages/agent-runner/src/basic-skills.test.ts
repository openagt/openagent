import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { createCheckout, HARNESS_SKILL_DIRS, skillLinkPaths } from '@openagt/skill-branches'
import { basicSkills, everyBasicSkill } from './basic-skills.js'
import { runCli } from './cli.js'
import { gitHostCommand } from './git-host.js'
import { SKILLS_ENV } from '@openagt/agent-data'
import { git, handDownBasicSkills, removeRepo, testRepo } from './test-repo.js'

// The skills every run gets, on a real repository: which ones a project has by its remote, what a
// checkout holds for them, that the command a text names runs with nothing downloaded, and that a
// cleanup takes the rules back.

const run = promisify(execFile)

test('a run gets no basic skill when nothing handed the list down: the runner names none itself', async () => {
  const repo = await testRepo()
  const before = process.env[SKILLS_ENV]
  try {
    delete process.env[SKILLS_ENV]
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    assert.deepEqual(await basicSkills(repo), [])
    assert.deepEqual(await everyBasicSkill(), [])
    assert.equal(await gitHostCommand(repo), undefined, 'nor a git host of its own')
  } finally {
    if (before === undefined) delete process.env[SKILLS_ENV]
    else process.env[SKILLS_ENV] = before
    await removeRepo(repo)
  }
})

handDownBasicSkills()
const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false)
const excludeOf = (repo: string): Promise<string> => readFile(join(repo, '.git', 'info', 'exclude'), 'utf8').catch(() => '')

test('every project gets logs and question; the git host\'s skill only where the project is on that host', async () => {
  const repo = await testRepo()
  try {
    // The test project's remote is a folder on this machine: no git host answers for it.
    assert.deepEqual((await basicSkills(repo)).map(skill => skill.name), ['logs', 'question'])
    await git(['remote', 'set-url', 'origin', 'https://gitlab.com/someone/project.git'], repo)
    assert.deepEqual((await basicSkills(repo)).map(skill => skill.name), ['logs', 'question'])
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    assert.deepEqual((await basicSkills(repo)).map(skill => skill.name), ['logs', 'question', 'github'])
    assert.deepEqual((await everyBasicSkill()).map(skill => skill.name), ['logs', 'question', 'github'], 'a cleanup knows all of them, whatever the remote')
    // A skill with a command brings its package; one that is only a text brings none.
    const byName = Object.fromEntries((await everyBasicSkill()).map(skill => [skill.name, skill]))
    assert.equal(byName['logs']!.package?.name, '@openagt/skill-logs')
    assert.deepEqual(Object.keys(byName['logs']!.package!.bins), ['logs'])
    assert.equal(byName['github']!.package?.name, '@openagt/skill-github')
    assert.equal(byName['question']!.package, undefined)
  } finally {
    await removeRepo(repo)
  }
})

test('a checkout holds each basic skill where every harness looks, with its command, hidden from git, and the full name runs that copy with nothing downloaded', async () => {
  const repo = await testRepo()
  try {
    // The remote is on GitHub only while a command that reads its address runs: making a checkout
    // and reading the runs both fetch from origin, and no test reaches a real host.
    const local = (await git(['remote', 'get-url', 'origin'], repo)).trim()
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    const skills = await basicSkills(repo)
    await git(['remote', 'set-url', 'origin', local], repo)
    const { path } = await createCheckout(repo, { agentId: 'a1', skills })
    for (const skill of skills) {
      for (const dir of HARNESS_SKILL_DIRS) {
        const text = await readFile(join(path, dir, skill.name, 'SKILL.md'), 'utf8')
        assert.match(text, new RegExp(`^name: ${skill.name}$`, 'm'), `${dir}/${skill.name} is the skill's text`)
      }
      if (!skill.package) continue
      assert.equal(await realpath(join(path, 'node_modules', skill.package.name)), await realpath(skill.package.dir))
      // The range the text names is the one the linked copy is in: a copy outside it would send `npx` to npm.
      const text = await readFile(join(skill.dir, 'SKILL.md'), 'utf8')
      const manifest: { version: string; openagent?: unknown } = JSON.parse(await readFile(join(skill.package.dir, 'package.json'), 'utf8'))
      const range = `${skill.package.name}@${manifest.version.split('.').slice(0, 2).join('.')}`
      assert.ok(text.includes(`npx ${range}`), `${skill.name}'s text names the range ${manifest.version} is in`)
      // A package that declares what it provides is named by its text, for a project that holds the text alone.
      if (manifest.openagent) assert.match(text, new RegExp(`^package: "${range}"$`, 'm'), `${skill.name}'s text names its package`)
    }
    assert.equal((await git(['status', '--porcelain'], path)).trim(), '', 'the links are not the agent\'s work')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '', 'nor the project\'s')
    // `npx` itself, kept off the network: the full name finds the linked copy and runs it.
    const logs = await run('npx', ['--offline', '--yes', '@openagt/skill-logs@0.1', '--limit', '1'], { cwd: path })
    assert.deepEqual(JSON.parse(logs.stdout), [])
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    const home = await run('npx', ['--offline', '--yes', '@openagt/skill-github@0.1', 'home'], { cwd: path })
    assert.equal(JSON.parse(home.stdout).url, 'https://github.com/someone/project')
  } finally {
    await removeRepo(repo)
  }
})

test('a project that tracks its own copy of a basic skill keeps it in the checkout', async () => {
  const repo = await testRepo()
  try {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(repo, '.claude', 'skills', 'question'), { recursive: true })
    await writeFile(join(repo, '.claude', 'skills', 'question', 'SKILL.md'), '---\nname: question\n---\nThe project\'s own way to ask.\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'our question skill'], repo)
    await git(['push', '-q', 'origin', 'main'], repo)
    const { path } = await createCheckout(repo, { agentId: 'a2', skills: await basicSkills(repo) })
    assert.match(await readFile(join(path, '.claude', 'skills', 'question', 'SKILL.md'), 'utf8'), /The project's own way to ask/)
    assert.equal((await git(['status', '--porcelain'], path)).trim(), '')
    // Nothing hides the project's own folder: a file a person adds beside its text shows in git.
    assert.ok(!(await readFile(join(path, '.claude', 'skills', '.gitignore'), 'utf8')).split('\n').includes('/question'), 'the tracked copy is not hidden')
    assert.ok((await readFile(join(path, '.agents', 'skills', '.gitignore'), 'utf8')).split('\n').includes('/question'), 'the folder the project has no copy in is linked and hidden')
    await writeFile(join(path, '.claude', 'skills', 'question', 'notes.md'), 'more\n')
    assert.equal((await git(['status', '--porcelain'], path)).trim(), '?? .claude/skills/question/notes.md')
  } finally {
    await removeRepo(repo)
  }
})

test('cleanup takes the rules of the basic skills\' packages back once no agent checkout is left, and leaves a person\'s lines', async () => {
  const repo = await testRepo()
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(repo, '.git', 'info', 'exclude'), '# mine\n/notes.txt\n')
    const skills = await everyBasicSkill()
    const { path } = await createCheckout(repo, { agentId: 'a3', skills })
    // A skill's text link is hidden in the checkout itself; its package's links, by the repository's exclude file.
    const rules = skills.flatMap(skillLinkPaths).filter(link => link.startsWith('node_modules/')).map(link => `/${link}`)
    assert.ok(rules.length > 0 && rules.length >= 2 * skills.filter(skill => skill.package).length, 'a command and its package for each skill that has one')
    for (const rule of rules) assert.ok((await excludeOf(repo)).split('\n').includes(rule), `${rule} hides a link`)

    const io = { cwd: repo, stdout: () => {}, stderr: () => {} }
    assert.equal(await runCli(['cleanup'], io), 0)
    for (const rule of rules) assert.ok((await excludeOf(repo)).split('\n').includes(rule), `${rule} stays while a checkout holds what it hides`)

    await git(['worktree', 'remove', '--force', path], repo)
    assert.equal(await exists(path), false)
    assert.equal(await runCli(['cleanup'], io), 0)
    const left = (await excludeOf(repo)).split('\n')
    for (const rule of rules) assert.ok(!left.includes(rule), `${rule} went`)
    assert.ok(left.includes('/notes.txt') && left.includes('# mine'), 'a person\'s own lines stay')
  } finally {
    await removeRepo(repo)
  }
})

test('a run\'s git host is the package the project installed for it, else the runner\'s own where the project is on that host; the runner\'s own names in the project\'s package.json are not read', async () => {
  const repo = await testRepo()
  try {
    const { mkdir, writeFile } = await import('node:fs/promises')
    assert.equal(await gitHostCommand(repo), undefined, 'a remote that is a folder: no git host')
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    const own = await gitHostCommand(repo)
    assert.equal(own?.package, '@openagt/skill-github', 'nothing installed in the project: the runner\'s own')

    // The project lists the runner's own package, at a copy of its own: that copy is not read.
    const listed = join(repo, 'node_modules', '@openagt', 'skill-github')
    await mkdir(listed, { recursive: true })
    await writeFile(join(listed, 'package.json'), JSON.stringify({ name: '@openagt/skill-github', bin: { github: 'cli.cjs' }, openagent: { 'git-host': 'github' } }))
    await writeFile(join(listed, 'cli.cjs'), '')
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'project', devDependencies: { '@openagt/skill-github': '*' } }))
    assert.equal((await gitHostCommand(repo))?.bin, own!.bin)

    // A git host the project installed itself comes first.
    const other = join(repo, 'node_modules', 'other-host')
    await mkdir(other, { recursive: true })
    await writeFile(join(other, 'package.json'), JSON.stringify({ name: 'other-host', bin: { 'other-host': 'cli.cjs' }, openagent: { 'git-host': 'other-host' } }))
    await writeFile(join(other, 'cli.cjs'), '')
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'project', devDependencies: { '@openagt/skill-github': '*', 'other-host': '*' } }))
    assert.equal((await gitHostCommand(repo))?.package, 'other-host')
  } finally {
    await removeRepo(repo)
  }
})
