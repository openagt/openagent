import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Locator, Page, Route } from 'playwright-core'
import { needsChrome, smoke } from './smoke.js'

// Where the keyboard is, in a real browser (smoke.ts): jsdom keeps the focus on a disabled button,
// so only a browser shows it dropped to the page.

const { flow, start, runIn } = smoke()

/** The calls to one of the daemon's RPCs, each held unanswered until `answer`. */
function hold(page: Page, name: string) {
  const held: Route[] = []
  const ready = page.route(url => url.pathname === `/_rpc/${name}`, route => void held.push(route))
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
    const remove = hold(page, '%40openagt%2Fprojects/removeProject')
    await page.getByRole('button', { name: 'Project actions' }).click()
    await page.getByRole('menuitem', { name: 'Remove project…' }).click()
    await waits(page, remove, () => page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click(), /^Removing…$/)
  })
})

test("Save in the profile editor keeps the keyboard while it waits and takes no second press", needsChrome, async () => {
  await flow('waiting-save', async page => {
    const save = hold(page, `${encodeURIComponent('@openagt/profiles')}/saveProfile`)
    await page.getByRole('link', { name: 'Profiles', exact: true }).click()
    await page.getByRole('button', { name: 'New profile' }).click()
    await page.getByRole('dialog').getByRole('textbox').first().fill('Reviewer')
    await waits(page, save, () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(), /Saving…/)
  })
})

test('Next in "Add project" keeps the keyboard while it waits and takes no second press', needsChrome, async () => {
  await flow('waiting-next', async page => {
    // The address is read once as the panel opens: that read is refused, so the form with Next stands.
    const next = hold(page, '%40openagt%2Fprojects/cloneTargetFor')
    let reads = 0
    await page.route(url => url.pathname === '/_rpc/%40openagt%2Fprojects/cloneTargetFor', route =>
      ++reads === 1 ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'not read yet' }) }) : route.fallback(),
    )
    await page.getByLabel('The session works in', { exact: true }).click()
    await page.getByLabel('Search projects and repos').fill('github.com/demo/elsewhere')
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
    // The menu that opened it gone, as it is by the time a person has read the question. Found by its
    // item: the session's gear menu stays mounted, shut, for what its lines say.
    await page.locator('[role="menu"]', { hasText: 'Create a repository on GitHub' }).waitFor({ state: 'detached' })
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
    // The section's presses wait until the accounts are read again, and the keyboard lands on one
    // once they are back: waited for, since on a busy machine that read takes longer than any
    // fixed pause.
    const inSection = `!!document.activeElement?.closest('[aria-label="GitHub"]')`
    await page.waitForFunction(inSection, undefined, { timeout: 10_000 }).catch(() => {})
    assert.ok(await page.evaluate(inSection), `the keyboard is in GitHub's section, not on ${await focused(page)}`)
  })
})

/** With the keyboard on the picker `name`'s button and its popup shut, "bl" typed: the picker opens searching for it, and nothing else changes. */
async function typedOnPicker(page: Page, name: string, search: string, unchanged: (button: Locator) => Promise<unknown>) {
  const button = page.getByRole('combobox', { name, exact: true })
  const before = await unchanged(button)
  await button.focus()
  await page.keyboard.type('bl')
  const field = page.getByLabel(search)
  await field.waitFor()
  await page.waitForTimeout(300)
  assert.equal(await field.inputValue(), 'bl', 'the search holds what was typed')
  assert.equal(await page.getByRole('dialog', { name: 'Add project' }).count(), 0, 'no dialog opened')
  assert.deepEqual(await unchanged(button), before, 'nothing was picked')
  await page.keyboard.press('Escape')
}

test("a letter typed on the sidebar's project picker starts its search and picks nothing", needsChrome, async () => {
  await flow('typed-sidebar-picker', async page => {
    await typedOnPicker(page, 'Project: shop', 'Search projects', button => button.getAttribute('aria-label'))
  })
})

test("a letter typed on the launcher's project picker starts its search and picks nothing", needsChrome, async () => {
  await flow('typed-launcher-picker', async page => {
    await typedOnPicker(page, 'The session works in', 'Search projects and repos', button => button.textContent())
  })
})

test("a letter typed on the launcher's branch picker starts its search and picks nothing", needsChrome, async () => {
  await flow('typed-branch-picker', async page => {
    // The demo's project has no origin, so git-branches offers no branch to start from: here it says it has one.
    const answer = (output: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ ret: { ok: true, output } }) })
    await page.route('**/_rpc/%40openagt%2Fgit-branches/startPlaces', route => route.fulfill(answer({ main: 'main', local: 'main' })))
    await page.route('**/_rpc/%40openagt%2Fgit-branches/startBranches', route => route.fulfill(answer({ branches: ['black', 'blue'] })))
    await page.reload()
    await page.getByLabel('The agent starts from', { exact: true }).waitFor()
    await typedOnPicker(page, 'The agent starts from', 'Search branches', button => button.textContent())
  })
})

test("a letter typed on a no-project session's Context starts its search and ticks nothing", needsChrome, async () => {
  await flow('typed-repos-context', async page => {
    await page.getByLabel('The session works in', { exact: true }).click()
    await page.getByRole('option', { name: 'No project' }).click()
    await typedOnPicker(page, 'Context', 'Search repos', button => button.textContent())
  })
})
