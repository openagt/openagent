import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { needsChrome, smoke } from './smoke.js'

// The project's pages, in a real browser (smoke.ts): a page a project's package brings, and adding
// a project from the picker.

const { demo, flow } = smoke()

test("the Tickets page lists the project's tickets", needsChrome, async () => {
  await flow('tickets', async page => {
    await page.getByRole('link', { name: 'Tickets', exact: true }).click()
    await page.getByText('Login page').waitFor()
    await page.getByText('Dark mode').waitFor()
  })
})

test("a class the dashboard says for one case wins over a module's plain one, whichever modules came in", needsChrome, async () => {
  await flow('one-order', async page => {
    await page.getByRole('link', { name: 'Tickets', exact: true }).click()
    await page.getByText('Dark mode').waitFor()
    await page.waitForFunction("[...document.querySelectorAll('link[rel=stylesheet]')].every(link => link.sheet)")
    // The dashboard's own pairs (FileIcon's dark picture, a box shown from a width up), whose plain halves modules use too.
    const display = await page.evaluate(`(() => {
      document.documentElement.classList.add('dark')
      const shown = className => {
        const box = document.body.appendChild(Object.assign(document.createElement('span'), { className }))
        const value = getComputedStyle(box).display
        box.remove()
        return value
      }
      return { dark: shown('hidden dark:inline-flex'), wide: shown('hidden sm:flex') }
    })()`)
    assert.deepEqual(display, { dark: 'inline-flex', wide: 'flex' })
  })
})

test("a ticket opened from every project's list goes back to that list from its page, after a reload too", needsChrome, async () => {
  await flow('ticket-back', async page => {
    await page.goto(`${demo().url}/tickets`)
    await page.getByText('Login page', { exact: true }).first().click()
    await page.waitForURL(url => url.pathname.endsWith('/tickets/2026-08-01_login-page.md'))
    await page.reload()
    await page.getByRole('main').getByRole('button', { name: 'Tickets', exact: true }).click()
    await page.waitForURL(url => !url.pathname.endsWith('.md'))
    assert.equal(new URL(page.url()).pathname, '/tickets')
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
