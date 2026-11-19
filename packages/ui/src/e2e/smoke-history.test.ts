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
    // Settings › Devices, joining with a code: what is typed is held until it is sent or thrown away.
    const field = dialog.getByRole('textbox', { name: 'Where' })
    const typed = '203.0.113.10'
    const asked = page.getByRole('alertdialog', { name: 'Discard your changes to Devices?' })
    /** The page is at `address`, with `entries` in the tab's list, after `step`. */
    const at = async (step: string, address: string, entries: number) => {
      await page.waitForFunction(`location.pathname + location.search === ${JSON.stringify(address)} && history.length === ${entries}`, undefined, { timeout: 5000 }).catch(() => {})
      const now = await where(page)
      t.diagnostic(`${step}: ${now.address} (${now.entries} entries)`)
      assert.deepEqual(now, { address, entries }, step)
    }
    const answer = async (button: 'Cancel' | 'Discard') => {
      await asked.getByRole('button', { name: button }).click()
      await asked.waitFor({ state: 'detached' })
    }
    const step = (go: 'back' | 'forward') => page.evaluate(go === 'back' ? 'history.back()' : 'history.forward()')

    // Joining by its address, closed onto the page: an entry of Settings with one ahead of it.
    await page.goto(`${demo().url}/${demo().project.id}?settings=devices&item=join`)
    await field.waitFor()
    const settings = '/shop?settings=devices&item=join'
    await page.waitForFunction(`location.pathname + location.search === ${JSON.stringify(settings)}`)
    const length = (await where(page)).entries
    await dialog.getByRole('button', { name: 'Close settings' }).click()
    await at('Joining by its address, closed', '/shop', length + 1)
    // Settings opened over the page: an entry of Settings with one behind it, and each step inside it in that one place.
    await page.getByRole('button', { name: /settings/i }).first().click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await dialog.getByRole('button', { name: 'Devices' }).click()
    await dialog.getByRole('button', { name: 'Join with a code' }).click()
    await field.waitFor()
    await at('Settings opened over the page, on joining', settings, length + 2)

    await field.fill(typed)
    await step('back')
    await asked.waitFor({ timeout: 5000 })
    await answer('Cancel')
    await at('Back, Cancel', settings, length + 2)
    assert.equal(await field.inputValue(), typed, 'what was typed is kept')

    await step('back')
    await asked.waitFor({ timeout: 5000 })
    await answer('Discard')
    await at('Back, Discard', '/shop', length + 2)
    await step('forward')
    await field.waitFor()
    await at('Forward still leads to Settings over the page', settings, length + 2)
    await step('back')
    await at('Back', '/shop', length + 2)
    await step('back')
    await field.waitFor()
    await at('Back to joining by its address', settings, length + 2)

    await field.fill(typed)
    await step('forward')
    await asked.waitFor({ timeout: 5000 })
    await answer('Cancel')
    await at('Forward, Cancel', settings, length + 2)
    await step('forward')
    await asked.waitFor({ timeout: 5000 })
    await answer('Discard')
    await at('Forward, Discard', '/shop', length + 2)
    await step('forward')
    await field.waitFor()
    await at('Forward still leads to Settings over the page', settings, length + 2)
  })
})
