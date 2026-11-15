import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Page } from 'playwright-core'
import { needsChrome, smoke } from './smoke.js'

// Back and Forward in a real browser (smoke.ts): what the tab's list of entries holds after each step.

const { demo, flow } = smoke()

/** The address shown and the length of the tab's list. */
const where = (page: Page): Promise<{ address: string; entries: number }> => page.evaluate('({ address: location.pathname + location.search, entries: history.length })')

test("a Back or Forward refused by a change in Settings not saved leaves the tab's list as it was", needsChrome, async t => {
  await flow('history-hold', async page => {
    const dialog = page.getByRole('dialog')
    const tick = dialog.getByRole('checkbox').first()
    const asked = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    /** The page is at `address`, with `entries` in the tab's list, after `step`. */
    const at = async (step: string, address: string, entries: number) => {
      await page.waitForFunction(`location.pathname + location.search === ${JSON.stringify(address)} && history.length === ${entries}`, undefined, { timeout: 5000 }).catch(() => {})
      const now = await where(page)
      t.diagnostic(`${step}: ${now.address} (${now.entries} entries)`)
      assert.deepEqual(now, { address, entries }, step)
    }
    const answer = async (button: 'Cancel' | 'Leave') => {
      await asked.getByRole('button', { name: button }).click()
      await asked.waitFor({ state: 'detached' })
    }
    const step = (go: 'back' | 'forward') => page.evaluate(go === 'back' ? 'history.back()' : 'history.forward()')

    // Skills by its address, closed onto the page: an entry of Settings with one ahead of it.
    await page.goto(`${demo().url}/${demo().project.id}?settings=skills`)
    await tick.waitFor()
    const settings = '/shop?settings=skills'
    await page.waitForFunction(`location.pathname + location.search === ${JSON.stringify(settings)}`)
    const length = (await where(page)).entries
    await dialog.getByRole('button', { name: 'Close settings' }).click()
    await at('Skills by its address, closed', '/shop', length + 1)
    // Settings opened over the page: an entry of Settings with one behind it.
    await page.getByRole('button', { name: /settings/i }).first().click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await dialog.getByRole('button', { name: 'Skills' }).click()
    await tick.waitFor()
    await at('Settings opened over the page, on Skills', settings, length + 2)

    const unticked = await tick.getAttribute('aria-checked')
    await tick.click()
    await step('back')
    await asked.waitFor({ timeout: 5000 })
    await answer('Cancel')
    await at('Back, Cancel', settings, length + 2)
    assert.notEqual(await tick.getAttribute('aria-checked'), unticked, 'the tick is kept')

    await step('back')
    await asked.waitFor({ timeout: 5000 })
    await answer('Leave')
    await at('Back, Leave', '/shop', length + 2)
    await step('forward')
    await tick.waitFor()
    await at('Forward still leads to Settings over the page', settings, length + 2)
    await step('back')
    await at('Back', '/shop', length + 2)
    await step('back')
    await tick.waitFor()
    await at('Back to Skills by its address', settings, length + 2)

    await tick.click()
    await step('forward')
    await asked.waitFor({ timeout: 5000 })
    await answer('Cancel')
    await at('Forward, Cancel', settings, length + 2)
    await step('forward')
    await asked.waitFor({ timeout: 5000 })
    await answer('Leave')
    await at('Forward, Leave', '/shop', length + 2)
    await step('forward')
    await tick.waitFor()
    await at('Forward still leads to Settings over the page', settings, length + 2)
  })
})
