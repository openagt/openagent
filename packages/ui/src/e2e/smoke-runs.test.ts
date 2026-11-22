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

test('a prompt typed the moment the launcher is there after a move from another page starts its run', needsChrome, async () => {
  await flow('start-after-a-move', async page => {
    const box = (await page.getByLabel('Prompt').boundingBox())!
    // A move the page makes itself, as a link or an automation does, not a reload: the browser
    // animates such a move between two documents where both ask for it, and the page coming in
    // takes no click while it plays.
    await page.evaluate('location.assign(location.href)')
    await page.waitForEvent('load')
    // The box is drawn and has the keyboard: a person who sees it there clicks it, then at once types the prompt and presses Enter.
    await page.waitForFunction(`document.activeElement?.getAttribute('aria-label') === 'Prompt'`)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.type('typed at once')
    await page.keyboard.press('Enter')
    await runIn('typed at once', ['done'])
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

/**
 * Run in the launcher's page: `window.shifts` names what moves behind the jump from then on, and
 * `window.lastShift` is when anything last moved. The jump's own rows are not counted: they move as
 * its list narrows to what is typed, and the rest of a name moves as more of it is found, which
 * Chrome reports only when it draws a frame between two letters. What moved and is gone by the time
 * Chrome says so has no node to tell by, so it is told by where it was: in the jump's box, as each
 * key found it (the box at its full size, whatever its opening has drawn of it so far).
 */
const SHIFTS_BEHIND_THE_JUMP = `(() => {
  window.shifts = []
  window.lastShift = performance.now()
  let box
  addEventListener('keydown', () => {
    const jump = document.querySelector('[role=dialog][aria-label="Jump to"]')
    if (!jump) return
    const drawn = jump.getBoundingClientRect()
    const left = drawn.x + drawn.width / 2 - jump.offsetWidth / 2
    box = { left, top: drawn.y, right: left + jump.offsetWidth, bottom: drawn.y + jump.offsetHeight }
  }, true)
  const inBox = rect => box !== undefined && rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom
  new PerformanceObserver(list => {
    for (const shift of list.getEntries()) {
      window.lastShift = performance.now()
      for (const { node, previousRect, currentRect } of shift.sources) {
        const element = node && (node.nodeType === 1 ? node : node.parentElement)
        if (element ? element.closest('[role=dialog][aria-label="Jump to"]') : inBox(previousRect) && inBox(currentRect)) continue
        window.shifts.push(element?.getAttribute('aria-label') ?? node?.textContent?.slice(0, 40) ?? 'gone since')
      }
    }
  }).observe({ type: 'layout-shift' })
})()`

test('Ctrl+K, a few letters and Enter land on a run from the launcher, and nothing behind the jump moves', needsChrome, async () => {
  await flow('jump', async page => {
    await start(page, 'ask about the jump colour')
    await page.getByRole('region', { name: 'Which way?' }).waitFor()
    // Back to the launcher as a person goes, by the sidebar: no reload redraws the lists under the jump.
    await page.getByRole('link', { name: 'New agent session' }).click()
    // The sidebar lists the run as waiting on a read of its own, which can come after the run's page
    // has drawn the question: its row coming in moves what is under it.
    await page.getByRole('link', { name: /ask about the jump colour.*Needs answer/ }).waitFor()
    // The launcher at rest, as a person sees it before reaching for the keys: a second with nothing moving.
    await page.evaluate(SHIFTS_BEHIND_THE_JUMP)
    await page.waitForFunction('performance.now() - window.lastShift > 1000')
    await page.evaluate('window.shifts = []')
    await page.getByRole('textbox', { name: 'Prompt' }).click()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Jump to' }).waitFor()
    await page.keyboard.type('jum')
    await page.getByRole('option', { name: /ask about the jump colour/ }).waitFor()
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: 'Which way?' }).waitFor()
    await page.getByRole('combobox', { name: 'Jump to' }).waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate('window.shifts'), [])
  })
})
