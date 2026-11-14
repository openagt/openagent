import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { needsChrome, smoke } from './smoke.js'

// The runs, in a real browser (smoke.ts): started from the launcher, answered, told more, stopped,
// and refused.

const { flow, start, runs, runIn } = smoke()

test('a run started from the launcher shows its answer as it comes, and ends done', needsChrome, async () => {
  await flow('start', async page => {
    await start(page, 'add a footer')
    await page.getByText(/done: .*add a footer/).waitFor()
    await runIn('add a footer', ['done'])
  })
})

test("a run's question is answered on its page, and the run goes on with the answer", needsChrome, async () => {
  await flow('answer', async page => {
    await start(page, 'ask about the footer colour')
    const question = page.getByRole('region', { name: 'Which way?' })
    await question.getByRole('radio', { name: /Right/ }).click()
    await question.getByRole('button', { name: 'Submit' }).click()
    await page.getByText(/The user chose: Right/).waitFor()
    await question.waitFor({ state: 'detached' })
  })
})

test('a message to a run that ended continues it', needsChrome, async () => {
  await flow('message', async page => {
    await start(page, 'add a header')
    await page.getByText(/done: .*add a header/).waitFor()
    await runIn('add a header', ['done'])
    await page.getByRole('textbox', { name: 'Message', exact: true }).click()
    await page.keyboard.type('and make it blue')
    await page.getByRole('button', { name: 'Send' }).click()
    await page.getByText(/done: .*and make it blue/).waitFor()
  })
})

test('a working run is stopped from its page', needsChrome, async () => {
  await flow('stop', async page => {
    await start(page, 'hold the release')
    // Pressed once the run is listed as working, as a person who sees it working presses it: a
    // Stop that comes before the run's card names its process is dropped by the daemon.
    await runIn('hold the release', ['running'])
    const stop = page.getByRole('button', { name: 'Stop agent' })
    await stop.click()
    await stop.waitFor({ state: 'detached' })
    await runIn('hold the release', ['stopped'])
  })
})

test('a start the project refuses says why, and keeps the prompt for another try', needsChrome, async () => {
  await flow('refused', async page => {
    await start(page, 'refuse this one')
    await page.getByText('the project has no such command').waitFor()
    assert.equal(await page.getByLabel('Prompt').innerText(), 'refuse this one')
    assert.equal((await runs()).find(agent => agent.intent === 'refuse this one'), undefined, 'no run began')
  })
})

test('Ctrl+K, a few letters and Enter land on a run from the launcher, and nothing behind the jump moves', needsChrome, async () => {
  await flow('jump', async page => {
    await start(page, 'ask about the jump colour')
    await page.getByRole('region', { name: 'Which way?' }).waitFor()
    // Back to the launcher as a person goes, by the sidebar: no reload redraws the lists under the jump.
    await page.getByRole('link', { name: 'New agent session' }).click()
    // The launcher at rest, as a person sees it before reaching for the keys: a second with nothing moving.
    await page.evaluate("window.shifts = []; window.lastShift = performance.now(); new PerformanceObserver(list => { for (const shift of list.getEntries()) { window.lastShift = performance.now(); window.shifts.push(shift.sources.map(source => source.node?.getAttribute?.('aria-label') ?? source.node?.textContent?.slice(0, 40))) } }).observe({ type: 'layout-shift' })")
    await page.waitForFunction('performance.now() - window.lastShift > 1000')
    await page.evaluate('window.shifts = []')
    await page.getByRole('textbox', { name: 'Prompt' }).click()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Jump to' }).waitFor()
    await page.keyboard.type('jum')
    await page.getByRole('option', { name: /ask about the jump colour/ }).waitFor()
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: 'Which way?' }).waitFor()
    assert.equal(await page.getByRole('combobox', { name: 'Jump to' }).count(), 0)
    assert.deepEqual(await page.evaluate('window.shifts'), [])
  })
})
