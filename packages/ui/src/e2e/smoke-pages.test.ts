import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { git } from './fixture.js'
import { needsChrome, smoke } from './smoke.js'

// The project's pages, in a real browser (smoke.ts): a page a project's package brings, adding
// a project from the picker, the list of files the message box opens, on a phone, the
// Overview's Human Queue, a package's card, and the project's skills, a package's entry of Settings.

const { demo, flow, start, runIn } = smoke()

test("the Overview's Human Queue, its package's card, lists the run waiting on its question, and the row opens that run", needsChrome, async () => {
  await flow('human-queue', async page => {
    await start(page, 'ask which colour the login page should be')
    const waiting = await runIn('ask which colour the login page should be', ['waiting'])
    await page.getByRole('link', { name: /^Overview/ }).click()
    const row = page.getByRole('region', { name: 'Human Queue' }).getByRole('link', { name: /^Needs answer/ })
    await row.waitFor()
    assert.match((await row.textContent()) ?? '', /Which way\?/)
    await row.click()
    await page.waitForURL(url => url.pathname.endsWith(`/${waiting.id}`))
  })
})

test("Settings › Skills, its package's entry, lists the project's own skills, what each says it does, and offers nothing to tick", needsChrome, async () => {
  await flow('skills', async page => {
    await page.goto(`${demo().url}/${demo().project.id}?settings=skills`)
    const list = page.getByRole('dialog').getByRole('list', { name: `Skills of ${demo().project.name}` })
    await list.waitFor()
    // The skills the demo's project committed, each on the branch its runs start from.
    for (const name of ['deploy', 'release-notes']) await list.getByRole('listitem').filter({ hasText: name }).first().waitFor()
    assert.equal(await list.getByText(/^Not on .* yet$/).count(), 0)
    assert.equal(await page.getByRole('dialog').getByRole('checkbox').count(), 0)
  })
})

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

test('a repository on the computer is added as a project from the picker, and its runs are scripted as the demo\u2019s own', needsChrome, async () => {
  await flow('add-project', async page => {
    const picker = page.getByRole('combobox', { name: 'The session works in', exact: true })
    await picker.click()
    await page.getByRole('option', { name: /blog/ }).click()
    await page.getByRole('button', { name: 'I trust it, add it' }).click()
    // The launcher picks the project added.
    await picker.filter({ hasText: 'blog' }).waitFor()
    const projects = await demo().call<Array<{ path: string }>>('onProjects')
    assert.ok(projects.some(project => project.path === demo().toAdd), 'the daemon has the project')
    // The add kept the lines the demo gave the folder: nothing stands in the way of a start, as the
    // real check would say of a coding agent that is not logged in, and a Start is the scripted agent's.
    await start(page, 'add an about page')
    await page.getByText(/done: .*add an about page/).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0, 'the check said nothing')
  })
})

test("the demo's project holds its own files alone, and its commits are its person's alone", needsChrome, async () => {
  // Its origin stands outside its folder: listed among its files, a bare repository's own (HEAD, config, hooks/…) were offered by the message box's #.
  const files = await demo().call<string[]>('onProjectFiles', demo().project.id)
  assert.ok(files.includes('README.md'), 'its files are listed')
  assert.deepEqual(files.filter(file => file !== 'README.md' && !file.startsWith('.claude/')), [])
  // A commit by anyone else is one more member on the Overview's card.
  const authors = (await git(demo().project.cwd, 'log', '--format=%an <%ae>', 'main')).trim().split('\n')
  assert.deepEqual([...new Set(authors)], ['Demo <demo@example.invalid>'])
})
