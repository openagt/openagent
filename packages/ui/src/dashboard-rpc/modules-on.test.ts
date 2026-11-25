import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '../project-id.js'
import { PROJECTS } from '@openagt/hooks'
import { distributionHooks, distributionSettings, projectRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { callModule } from './module-calls.js'
import { provideTestContext } from './test-context.js'

handDownTestDistribution()
provideTestContext()

// What a module's server part is told of the modules on (`RpcHost.modulesOn`), as the skills
// module's choices read it through the shell's call: the distribution's, in the project called in.

/** The plugins and the core modules' skills skills' server part says a session picks from. */
async function choices(projectId: string, input: object = {}): Promise<unknown> {
  const result = await callModule(projectId, '@openagt/skills', 'skillChoices', input)
  if (!result.ok) throw new Error(result.error)
  const { core, plugins } = result.output as { core: string[]; plugins: unknown[] }
  return { core, plugins }
}

test("the modules on: with no project, the plugins that start on; in a project, the ones on there, each with its skills and whether it has a step; with `every`, every plugin, off ones too", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-on-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    assert.deepEqual(await choices(SESSIONS_ID), { core: [], plugins: [{ name: 'ask', skills: ['ask'] }] }, 'ask starts on')
    const every = (await choices(SESSIONS_ID, { every: true })) as { plugins: { name: string }[] }
    assert.ok(every.plugins.some(plugin => plugin.name === 'tickets'), 'every plugin a run gets something from, off ones too')
    assert.equal(every.plugins.some(plugin => plugin.name === 'store-git-repository'), false, 'not one a run gets nothing from')

    // A project on GitHub, with tickets on: github's skill is every run's there, tickets' a pick beside ask's.
    const shop = join(dir, 'shop')
    await mkdir(shop)
    execFileSync('git', ['init', '-q'], { cwd: shop })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/shop.git'], { cwd: shop })
    await (await distributionSettings()).set(PROJECTS, [{ id: projectId(shop), path: shop, addedAt: '2026-09-19T00:00:00.000Z' }])
    await (await distributionHooks()).setEnabled('tickets', true, await projectRefAt(projectId(shop), shop))
    assert.deepEqual(await choices(projectId(shop)), { core: ['github'], plugins: [{ name: 'ask', skills: ['ask'] }, { name: 'tickets', skills: ['tickets', 'plan', 'plan-tickets', 'triage', 'update-tickets', 'suggest-tickets-to-work-on'] }] })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
