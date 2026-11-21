import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { pluginSkills } from './plugin-skills.js'

test("the plugins' skills are read off the distribution handed down, as a run's process reads them: none without one, and what could not be read is said", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scheduler-distribution-'))
  try {
    assert.deepEqual(await pluginSkills(dir, undefined, {}), { skills: [], unreadable: [] }, 'started by hand, outside OpenAgent: no distribution')
    const file = join(dir, 'distribution.mjs')
    await writeFile(
      file,
      `export default [
  { module: { name: 'nightly', hooks: { 'run.skills': () => [{ name: 'nightly', dir: new URL('./nightly/', import.meta.url) }] } } },
  { module: { name: 'broken', hooks: { 'run.skills': () => { throw new Error('no skills today') } } } },
]\n`,
    )
    const read = await pluginSkills(dir, undefined, { [DISTRIBUTION_ENV]: file })
    // Under the folder's real path: node imports the distribution from there, so its `import.meta.url` is
    // the temp folder with its links followed (macOS's /var is /private/var).
    assert.deepEqual(read.skills.map(skill => ({ ...skill, dir: resolve(skill.dir) })), [{ name: 'nightly', dir: join(await realpath(dir), 'nightly'), plugin: 'nightly' }])
    assert.deepEqual(read.unreadable, [{ skill: "the broken plugin's skills", reason: 'no skills today' }])
    // Another file: a module once imported is the one every import of its file gets.
    const wrong = join(dir, 'wrong.mjs')
    await writeFile(wrong, 'export default 42\n')
    const broken = await pluginSkills(dir, undefined, { [DISTRIBUTION_ENV]: wrong })
    assert.deepEqual(broken.skills, [])
    assert.equal(broken.unreadable[0]?.skill, "the plugins' skills")
    assert.match(broken.unreadable[0]!.reason, /default-exports no distribution/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
