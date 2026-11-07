import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from './git.js'
import { agentIdOf, agentsDir, builtInDefault, isAgentName, listAgents, readAgent, removeAgent, writeAgent } from './agents.js'

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'oa-agents-'))
}

test('an agent\'s id is its name as a path-safe word; a name that gives none is no name', () => {
  assert.equal(agentIdOf('Social Media'), 'social-media')
  assert.equal(agentIdOf('  Rom’s reviewer! '), 'rom-s-reviewer')
  assert.equal(isAgentName('Social Media'), true)
  assert.equal(isAgentName('!!!'), false)
  assert.equal(isAgentName(''), false)
  assert.equal(isAgentName('x'.repeat(41)), false)
  assert.equal(isAgentName(42), false)
})

test('the default agent is built in until it has a file; another id with no file is no agent', async () => {
  const dir = await folder()
  try {
    assert.deepEqual(await readAgent('default', dir), { id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {}, projectSkills: true })
    assert.equal(await readAgent('reviewer', dir), undefined)
    assert.equal(await readAgent('../etc', dir), undefined)
    assert.deepEqual(await listAgents(dir), [builtInDefault()])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an agent is written as one file in the personal folder, committed there, read back with only what is an agent; the default first in the list; removed again, never the default', async () => {
  const dir = await folder()
  const git = nodeGitRunner()
  try {
    const written = await writeAgent({ id: 'reviewer', name: 'Reviewer', skills: ['ask', 'github', 'readability'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: false }, { folder: dir })
    assert.equal(written.ok, true)
    assert.deepEqual(JSON.parse(await readFile(join(agentsDir(dir), 'reviewer.json'), 'utf8')), { name: 'Reviewer', skills: ['ask', 'github', 'readability'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: false })
    assert.equal((await readAgent('reviewer', dir))!.projectSkills, false, 'an agent set to never pick up project skills reads back so')
    assert.match(await git(['log', '-1', '--format=%s'], dir), /agent Reviewer/)
    assert.equal((await git(['status', '--porcelain'], dir)).trim(), '', 'committed')
    // The default edited: its file takes over from the built-in one.
    await writeAgent({ id: 'default', name: 'Default', skills: ['ask'], accounts: { github: 'octo' }, projectSkills: true }, { folder: dir })
    assert.deepEqual(await readAgent('default', dir), { id: 'default', name: 'Default', skills: ['ask'], accounts: { github: 'octo' }, projectSkills: true })
    // A file with more than an agent, or less: only what is one is read; a broken one is no agent.
    await writeFile(join(agentsDir(dir), 'odd.json'), JSON.stringify({ name: ' Odd ', skills: ['ok', 'Not Ok', 3, 'ok'], accounts: { github: ' ', claude: [], codex: ['Rom'], slack: 'x' }, extra: 1 }))
    // A file from before the project-skills word, or one that says something odd there: the skills are on.
    assert.deepEqual(await readAgent('odd', dir), { id: 'odd', name: 'Odd', skills: ['ok'], accounts: { codex: ['Rom'] }, projectSkills: true })
    await writeFile(join(agentsDir(dir), 'broken.json'), '{')
    assert.equal(await readAgent('broken', dir), undefined)
    await mkdir(join(agentsDir(dir), 'not-a-file.json'))
    assert.deepEqual((await listAgents(dir)).map(agent => agent.id), ['default', 'odd', 'reviewer'])

    await removeAgent('reviewer', { folder: dir })
    assert.equal(await readAgent('reviewer', dir), undefined)
    assert.match(await git(['log', '-1', '--format=%s'], dir), /remove agent reviewer/)
    await assert.rejects(removeAgent('default', { folder: dir }), /cannot be removed/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
