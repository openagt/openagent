import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { needsChrome, smoke } from './smoke.js'

// The project's pages, in a real browser (smoke.ts): a page a project's package brings, and adding
// a project from the picker.

const { demo, flow } = smoke()

test("the Tickets page lists the project's tickets", needsChrome, async () => {
  await flow('tickets', async page => {
    await page.getByRole('button', { name: 'Tickets', exact: true }).click()
    await page.getByText('Login page').waitFor()
    await page.getByText('Dark mode').waitFor()
  })
})

test('a repository on the computer is added as a project from the picker', needsChrome, async () => {
  await flow('add-project', async page => {
    await page.getByLabel('Project: shop').click()
    await page.getByRole('option', { name: /blog/ }).click()
    await page.getByRole('button', { name: 'I trust it, add it' }).click()
    await page.getByLabel('Project: blog').waitFor()
    const projects = await demo().call<Array<{ path: string }>>('onProjects')
    assert.ok(projects.some(project => project.path === demo().toAdd), 'the daemon has the project')
  })
})
