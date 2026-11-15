import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { needsChrome, smoke } from './smoke.js'

// The project's pages, in a real browser (smoke.ts): a page a project's package brings, adding
// a project from the picker, and the list of files the message box opens, on a phone.

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
    // The dashboard's own pairs (FileIcon's dark picture, the wordmark hidden on a narrow screen), whose plain halves modules use too.
    await page.setViewportSize({ width: 390, height: 800 })
    const display = await page.evaluate(`(() => {
      document.documentElement.classList.add('dark')
      const shown = className => {
        const box = document.body.appendChild(Object.assign(document.createElement('span'), { className }))
        const value = getComputedStyle(box).display
        box.remove()
        return value
      }
      return { dark: shown('hidden dark:inline-flex'), narrow: shown('flex max-sm:hidden') }
    })()`)
    assert.deepEqual(display, { dark: 'inline-flex', narrow: 'none' })
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

test("the files a # lists stay on a phone's screen, each with its name whole", needsChrome, async () => {
  await flow('files-on-a-phone', async page => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.getByLabel('Prompt').click()
    // A few words first: the caret is then in the right half of the screen, where the list used to start.
    await page.keyboard.type('please have a look at the file #skills')
    const list = page.getByRole('listbox', { name: 'Suggestions' })
    await list.getByRole('option').first().waitFor()
    // Where the list is, and each row's name and hint: whole, the name before the hint.
    const seen = (await page.evaluate(`(() => {
      const listbox = document.querySelector('[role=listbox][aria-label=Suggestions]')
      const cut = part => part.scrollWidth > part.clientWidth
      return {
        screen: document.documentElement.clientWidth,
        left: listbox.getBoundingClientRect().left,
        right: listbox.getBoundingClientRect().right,
        rows: [...listbox.querySelectorAll('[role=option]')].map(row => {
          const [name, hint] = [row.firstElementChild.lastElementChild, row.lastElementChild]
          return { name: name.textContent, nameCut: cut(name) || name.getBoundingClientRect().right > hint.getBoundingClientRect().left, hint: hint.textContent, hintCut: cut(hint) }
        }),
      }
    })()`)) as { screen: number; left: number; right: number; rows: Array<{ name: string; nameCut: boolean; hint: string; hintCut: boolean }> }
    assert.ok(seen.left >= 0 && seen.right <= seen.screen, `the list is on the screen: ${seen.left} to ${seen.right} of ${seen.screen}`)
    assert.ok(seen.rows.length > 1, 'the project has several files under skills')
    for (const row of seen.rows) assert.deepEqual(row, { name: 'SKILL.md', nameCut: false, hint: 'file', hintCut: false })
    await page.keyboard.press('Escape')
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
