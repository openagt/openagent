import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Page, Route } from 'playwright-core'
import { needsChrome, smoke } from './smoke.js'

// Where the keyboard is, in a real browser (smoke.ts): jsdom keeps the focus on a disabled button,
// so only a browser shows it dropped to the page.

const { flow, start, runIn } = smoke()

/** The calls to one of the daemon's RPCs, each held unanswered until `answer`. */
function hold(page: Page, name: string) {
  const held: Route[] = []
  const ready = page.route(`**/_rpc/${name}`, route => void held.push(route))
  return {
    ready,
    count: () => held.length,
    /** Answer every held call as a refusal, so nothing is changed. */
    answer: () => Promise.all(held.splice(0).map(route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'held by the story' }) }))),
  }
}

/** What has the keyboard: its name as a person hears it. */
const focused = (page: Page): Promise<string> =>
  page.evaluate("(at => !at || at === document.body ? 'body' : (at.getAttribute('aria-label') ?? at.textContent ?? at.tagName).trim())(document.activeElement)")

/** Press `press`, then while its call waits: the press keeps the keyboard, and a second press by key sends nothing more. */
async function waits(page: Page, call: ReturnType<typeof hold>, press: () => Promise<void>, name: RegExp) {
  await call.ready
  await press()
  // Past the frame in which Chrome takes the focus off a button that turned disabled.
  await page.waitForTimeout(300)
  assert.match(await focused(page), name, 'the waiting press keeps the keyboard')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  assert.equal(call.count(), 1, 'a second press sends no second call')
  await call.answer()
}

test('Remove in "Remove project" keeps the keyboard while it waits and takes no second press', needsChrome, async () => {
  await flow('waiting-remove', async page => {
    const remove = hold(page, 'sendRemoveProject')
    await page.getByRole('button', { name: 'Project actions' }).click()
    await page.getByRole('menuitem', { name: 'Remove project…' }).click()
    await waits(page, remove, () => page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click(), /^Removing…$/)
  })
})

test("Save in the agent editor keeps the keyboard while it waits and takes no second press", needsChrome, async () => {
  await flow('waiting-save', async page => {
    const save = hold(page, 'sendSaveAgent')
    await page.getByRole('link', { name: 'Agents', exact: true }).click()
    await page.getByRole('button', { name: 'New agent' }).click()
    await page.getByRole('dialog').getByRole('textbox').first().fill('Reviewer')
    await waits(page, save, () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(), /Saving…/)
  })
})

test('Next in "Add project" keeps the keyboard while it waits and takes no second press', needsChrome, async () => {
  await flow('waiting-next', async page => {
    // The address is read once as the panel opens: that read is refused, so the form with Next stands.
    const next = hold(page, 'onCloneTarget')
    let reads = 0
    await page.route('**/_rpc/onCloneTarget', route =>
      ++reads === 1 ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'not read yet' }) }) : route.fallback(),
    )
    await page.getByLabel('Project: shop').click()
    await page.keyboard.type('github.com/demo/elsewhere')
    await page.getByRole('option', { name: /github\.com\/demo\/elsewhere/ }).click()
    const form = page.getByRole('dialog', { name: 'Add project' })
    await form.getByText('not read yet').waitFor()
    await waits(page, next, () => form.getByRole('button', { name: 'Next' }).click(), /^Next$/)
  })
})

test('Escape in a question over a working run closes the question and stops nothing', needsChrome, async () => {
  await flow('escape-question', async page => {
    await page.route('**/_rpc/onRepositoryOffer', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ret: { repository: 'demo/shop', name: 'GitHub' } }) }))
    let stops = 0
    await page.route('**/_rpc/sendStop', route => (stops++, route.fallback()))
    await start(page, 'hold the escape')
    await runIn('hold the escape', ['running'])
    await page.getByRole('button', { name: 'Stop agent' }).waitFor()
    await page.getByRole('button', { name: 'Project actions' }).click()
    await page.getByRole('menuitem', { name: 'Create a repository on GitHub…' }).click()
    const question = page.getByRole('alertdialog', { name: 'Create a private repository on GitHub?' })
    await question.waitFor()
    // The menu that opened it gone, as it is by the time a person has read the question.
    await page.locator('[role="menu"]').waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await question.waitFor({ state: 'detached' })
    await page.waitForTimeout(500)
    assert.equal(stops, 0, 'no stop was sent')
    await runIn('hold the escape', ['running'])
  })
})

test("a git account forgotten from its row leaves the keyboard in its host's section", needsChrome, async () => {
  await flow('forget-account', async page => {
    let forgotten = false
    const account = (login: string) => ({ login, ok: true })
    await page.route('**/_rpc/onGitHosts', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ret: { hosts: [{ host: 'github.com', projects: ['shop'], provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'gh', accounts: forgotten ? [account('alice')] : [account('alice'), account('bob')] } }] } }),
      }),
    )
    await page.route('**/_rpc/sendForgetGitHostAccount', route => ((forgotten = true), route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ret: { ok: true } }) })))
    await page.reload()
    await page.getByRole('link', { name: 'Permissions', exact: true }).click()
    await page.getByRole('button', { name: 'More for @bob' }).click()
    await page.getByRole('menuitem', { name: 'Remove' }).click()
    await page.getByRole('group', { name: 'Remove @bob' }).getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('listitem', { name: '@bob' }).waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    assert.ok(await page.evaluate(`!!document.activeElement?.closest('[aria-label="GitHub"]')`), `the keyboard is in GitHub's section, not on ${await focused(page)}`)
  })
})
