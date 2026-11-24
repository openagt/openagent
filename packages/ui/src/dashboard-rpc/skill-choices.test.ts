import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '@openagt/agent-data'
import { listTestProject } from '../test-projects.js'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { onSkillChoices } from './skill-choices.js'
import { provideTestContext } from './test-context.js'

handDownTestDistribution()
provideTestContext()

test("a session picks from the plugins on in its project that give its runs a skill or a step, and with no project from the ones that start on; the core modules' skills are no pick", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skill-choices-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    assert.deepEqual(await onSkillChoices(SESSIONS_ID), { core: [], plugins: [{ name: 'ask', skills: ['ask'] }] }, 'ask starts on')
    assert.equal(await onSkillChoices('nowhere-1'), null, 'a project unknown here')

    // A project on GitHub, with tickets on: github's skill is every run's there, tickets' a pick beside ask's, with the commands about the tickets.
    const shop = join(dir, 'shop')
    await mkdir(shop)
    execFileSync('git', ['init', '-q'], { cwd: shop })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/shop.git'], { cwd: shop })
    await listTestProject(shop, '2026-09-19T00:00:00.000Z')
    await (await distributionHooks()).setEnabled('tickets', true, await projectRefAt(projectId(shop), shop))
    assert.deepEqual(await onSkillChoices(projectId(shop)), { core: ['github'], plugins: [{ name: 'ask', skills: ['ask'] }, { name: 'tickets', skills: ['tickets', 'plan', 'plan-tickets', 'triage', 'update-tickets', 'suggest-tickets-to-work-on'] }] })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
