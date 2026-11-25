import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nodeGitRunner, createCheckout, HARNESS_SKILL_DIRS } from '@openagt/git-branches'
import type { ProjectRef } from '@openagt/hooks'
import { fakeRun } from '@openagt/hooks/testing'
import { skillsModule } from './module.js'

const git = nodeGitRunner()
const commit = (repo: string, message: string) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], repo)

/** A package with a skill's text and the command the text teaches. */
async function skillPackage(root: string, name: string): Promise<string> {
  const dir = join(root, name)
  await mkdir(join(dir, 'bin'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@openagt/skill-${name}`, bin: { [name]: `bin/${name}` } }))
  await writeFile(join(dir, 'bin', name), '#!/bin/sh\n')
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} it.\n---\n`)
  return dir
}

test("a run's skills are linked into its checkout for every coding agent, with the command each teaches, hidden from git; the project's own skill of a name and the ones the run leaves out are its own", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'skills-module-')))
  const repo = join(base, 'repo')
  try {
    await mkdir(repo)
    await git(['init', '-q', '-b', 'main'], repo)
    await mkdir(join(repo, '.agents', 'skills', 'deploy'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\n')
    await mkdir(join(repo, '.agents', 'skills', 'tickets'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'tickets', 'SKILL.md'), '---\nname: tickets\n---\nThe project\'s own.\n')
    await git(['add', '-A'], repo)
    await commit(repo, 'init')
    const [queue, tickets] = await Promise.all([skillPackage(base, 'queue'), skillPackage(base, 'tickets')])
    const { path: checkout } = await createCheckout(repo, { agentId: 'a1' })
    const project: ProjectRef = { id: 'shop', name: 'shop', dir: repo }
    const step = skillsModule().hooks['run.step']![0]!
    const ctx = fakeRun({ project, workspace: checkout, options: { skills: { project: ['tickets'] } }, skills: [{ name: 'queue', dir: pathToFileURL(`${queue}/`), command: 'queue' }, { name: 'tickets', dir: tickets, command: 'tickets' }] })
    await step.run(ctx)

    for (const dir of HARNESS_SKILL_DIRS) assert.match(await readFile(join(checkout, dir, 'queue', 'SKILL.md'), 'utf8'), /^name: queue$/m, `${dir} has the module's skill`)
    assert.equal(await realpath(join(checkout, 'node_modules', '.bin', 'queue')), join(queue, 'bin', 'queue'), 'with its command')
    assert.match(await readFile(join(checkout, '.agents', 'skills', 'tickets', 'SKILL.md'), 'utf8'), /The project's own/, "a project's own skill of the name stays")
    assert.equal(await lstat(join(checkout, '.agents', 'skills', 'deploy')).then(() => true, () => false), false, 'a skill of its own the run leaves out is out of its checkout')
    assert.equal((await git(['status', '--porcelain'], checkout)).trim(), '', 'nothing to commit')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
