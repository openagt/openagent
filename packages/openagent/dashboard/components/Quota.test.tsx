import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProjectSummary, QuotaView } from '../../src/index.js'
import type { ModuleHost, ModuleProject } from '../module/index.js'
import { ModulesContext, type MountedModules, type MountedUsageLimit } from '../lib/use-modules.js'
import { hoverTooltip } from '../test-utils.js'


/** The main figure's own trigger — its text is split across nodes (a coloured span for the
 * duration), so an exact string match on `getByText` can't find it as one element. */
function mainFigureTrigger(): HTMLElement {
  return screen.getByText(/^Resets /).closest('p')!.querySelector('.cursor-default')!
}

// The stop line a module puts on the bar: what its read answers, and its save, as the tests set them.
const sendSpendOffset = vi.fn(async (_points: number): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }))
let savedOffset = 0
const readOffset = vi.fn(async (_host: ModuleHost, _projects: ModuleProject[]): Promise<number | undefined> => savedOffset)
const usageLimit: MountedUsageLimit = { package: '@openagt/skill-scheduler', projects: ['p1'], read: readOffset, save: (_host, _projects, points) => sendSpendOffset(points) }
const NOTHING: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], everyPage: [], loaded: true }
const PROJECTS: ProjectSummary[] = [
  { id: 'p1', path: '/p1', name: 'gemstack', activated: true, gitHost: true },
  { id: 'p2', path: '/p2', name: 'other', activated: true, gitHost: false },
]

let view: QuotaView | undefined
vi.mock('../lib/quota.js', () => ({ useQuota: () => view }))
// The added accounts' rows have their own suite; here only whether there are some.
let added: { id: string; name: string; own: boolean }[] = []
vi.mock('./AgentAccounts.js', () => ({ AddedAccountsUsage: () => null, useAgentAccounts: () => ({ view: { accounts: added } }) }))

const { Quota } = await import('./Quota.js')

/** The panel with a module's stop line on its bar, once the module's first read has put the handle there. */
async function show() {
  const shown = render(
    <ModulesContext.Provider value={{ ...NOTHING, usageLimit }}>
      <Quota projects={PROJECTS} />
    </ModulesContext.Provider>,
  )
  if (view?.boundary) await screen.findByLabelText('Unattended work stops at')
  return shown
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const STARTS_AT = new Date(2026, 6, 21, 19, 0, 0).getTime() // Tue evening, the mid-day-start case

/** A reading with a placeable week, so the bar has an axis to draw. */
function reading(percentUsed: number, limitOffset = 0): QuotaView {
  return readingAt(4, percentUsed, limitOffset) // day four of seven
}

/** Same, with the boundary at an arbitrary day — for the offset's clamp, which needs room to test. */
function readingAt(day: number, percentUsed: number, limitOffset = 0): QuotaView {
  const boundaryPercent = (day / 7) * 100
  savedOffset = limitOffset
  return {
    windows: [
      { label: 'Current week (all models)', kind: 'week', percentUsed, resetsAtText: 'Jul 28 at 7pm' },
      { label: 'Current session', kind: 'session', percentUsed: 3 },
    ],
    boundary: { startsAt: STARTS_AT, resetsAt: STARTS_AT + WEEK_MS, day, percent: boundaryPercent },
  }
}

beforeEach(() => {
  view = undefined
  savedOffset = 0
  readOffset.mockClear()
  sendSpendOffset.mockClear()
  sendSpendOffset.mockImplementation(async () => ({ ok: true }))
})
afterEach(cleanup)

describe("Quota's stop line is a module's", () => {
  test('with no module that declares one the bar shows the account only: no handle, no budget, no enabled or disabled', async () => {
    view = reading(20)
    const { container } = render(
      <ModulesContext.Provider value={NOTHING}>
        <Quota projects={PROJECTS} />
      </ModulesContext.Provider>,
    )
    const bar = screen.getByRole('img')
    expect(bar.getAttribute('aria-label')).toMatch(/20% of the week used, against a boundary of 57%/)
    expect(screen.queryByLabelText('Unattended work stops at')).toBeNull()
    expect(bar.querySelectorAll('.opacity-35')).toHaveLength(0)
    expect(screen.queryByText('Budget for Autonomous AI')).toBeNull()
    expect(container.querySelector('em')).toBeNull()
    expect(screen.getByText('Quota boundary')).toBeTruthy()
    expect(readOffset).not.toHaveBeenCalled()
  })

  test('the module is asked with only the projects that have its package, and its answer is where the handle rests', async () => {
    view = reading(20, 15)
    await show()
    expect(readOffset.mock.calls[0]![1]).toEqual([{ id: 'p1', name: 'gemstack', gitHost: true }])
    expect(Number((screen.getByLabelText('Unattended work stops at') as HTMLInputElement).value)).toBeCloseTo((4 / 7) * 100 + 15, 5)
  })

  test('a module that reads no offset leaves the bar without a handle', async () => {
    view = reading(20)
    readOffset.mockImplementationOnce(async () => undefined)
    render(
      <ModulesContext.Provider value={{ ...NOTHING, usageLimit }}>
        <Quota projects={PROJECTS} />
      </ModulesContext.Provider>,
    )
    await waitFor(() => expect(readOffset).toHaveBeenCalled())
    expect(screen.queryByLabelText('Unattended work stops at')).toBeNull()
  })
})

describe('Quota (#960)', () => {
  test('says it is reading rather than drawing an empty week', async () => {
    await show()
    // An empty track would read as "nothing used", which is the opposite of "we do not know yet".
    expect(screen.getByText(/Reading your usage/)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('draws the week as one track, labelled with where consumption stands', async () => {
    view = reading(20)
    await show()
    const bar = screen.getByRole('img')
    expect(bar.getAttribute('aria-label')).toMatch(/20% of the week used/)
    expect(bar.getAttribute('aria-label')).toMatch(/boundary of 57%/)
    expect(bar.getAttribute('aria-label')).toMatch(/day 4 of 7/)
  })

  test('draws one day label per calendar day, and a separator between each (#960 Edit)', async () => {
    view = reading(20)
    await show()
    // STARTS_AT is a Tuesday evening: the fixture's mid-day-start case, so `TU` reads once, at
    // whichever end of the bar most of Tuesday actually falls (the end, here).
    const labels = screen.getAllByText(/^[A-Z]{2}$/).map(el => el.textContent)
    expect(labels).toEqual(['WE', 'TH', 'FR', 'SA', 'SU', 'MO', 'TU'])
    // One separator less than the number of calendar days the week touches (no separator before
    // the very first day), plus the used/dimmed fills and the boundary line.
    expect(screen.getByRole('img').querySelectorAll(':scope > div')).toHaveLength(10)
  })

  test('the session window is reachable through the bar\'s "show all limits" tooltip, never as its own bar', async () => {
    view = reading(20)
    await show()
    // One bar, and it is the account's week.
    expect(screen.getAllByRole('img')).toHaveLength(1)
    await hoverTooltip(screen.getByText('Show all limits'))
    expect(screen.getByText('Current session')).toBeTruthy()
  })

  test('the handle is valued on the bar\'s own scale, but writes an offset from the boundary through the module\'s save (#960)', async () => {
    view = reading(20)
    await show()
    const slider = screen.getByLabelText('Unattended work stops at') as HTMLInputElement
    const boundaryPercent = (4 / 7) * 100
    // At rest it sits exactly on the boundary tick beneath it, not at some offset-scale zero.
    expect(Number(slider.value)).toBeCloseTo(boundaryPercent, 5)
    fireEvent.change(slider, { target: { value: String(boundaryPercent + 15) } })
    await waitFor(() => expect(sendSpendOffset).toHaveBeenCalledWith(15))
  })

  test('an unreadable quota explains itself instead of showing a zeroed bar', async () => {
    view = { windows: [], unavailable: 'agent-not-found' }
    await show()
    expect(screen.getByText(/Claude Code was not found/)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    // And no slider: there is no line to move.
    expect(screen.queryByLabelText('Unattended work stops at')).toBeNull()
  })

  test('why the own login has no reading is not said while runs use other accounts, as a server\'s use the person\'s own computer\'s', async () => {
    view = { windows: [], unavailable: 'no-subscription' }
    added = [{ id: 'Suleiman', name: 'Suleiman', own: false }]
    try {
      await show()
      expect(screen.queryByText(/no subscription usage to report/)).toBeNull()
    } finally {
      added = []
    }
  })

  test('a week with no reset time says so, rather than denying the week exists', async () => {
    // The third way to be unplaceable, and the one an untouched account hits: nothing consumed, so
    // Claude Code prints the window without its `· resets …` tail. `quotaBoundaryStatus` yields no
    // boundary without that text, and the panel used to borrow the "no week" wording — while the
    // list right below the alert showed the very week it claimed not to have.
    view = {
      windows: [
        { label: 'Current week (all models)', kind: 'week', percentUsed: 0 },
        { label: 'Current session', kind: 'session', percentUsed: 0 },
      ],
      readAt: Date.now(),
    }
    await show()
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/no reset time/)
    expect(alert).toMatch(/Current week \(all models\)/)
    expect(alert).not.toMatch(/no “Current week \(all models\)” line/) // it has one; that is the point
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('a readout with no week at all names the missing line and what came instead (#1367 follow-up)', async () => {
    // The readout is prose from another program, so when the week is simply absent the labels that
    // *did* arrive are the whole diagnosis — this used to say only "no week this version can
    // place", which nobody can act on or paste into an issue.
    view = {
      windows: [
        { label: 'Current session', kind: 'session', percentUsed: 3 },
        { label: 'Current week (Fable)', kind: 'week-model', percentUsed: 15 },
      ],
      readAt: Date.now(),
    }
    await show()
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/Couldn't parse quota/)
    expect(alert).toMatch(/Current week \(all models\)/) // the line the parser wanted
    expect(alert).toMatch(/“Current session”/) // and the ones it got
    expect(alert).toMatch(/“Current week \(Fable\)”/)
  })

  test('a week it cannot place is an error, not a quietly plainer panel', async () => {
    // The failure this test exists for: Claude Code rephrased its reset times and the parser
    // missed, so the boundary vanished — and the panel just showed the week as a plain figure,
    // as if that were a design choice. No fallback: name the text that did not parse.
    view = {
      windows: [
        { label: 'Current week (all models)', kind: 'week', percentUsed: 45, resetsAtText: 'Jul 28, 9pm (Europe/Berlin)' },
        { label: 'Current session', kind: 'session', percentUsed: 3 },
      ],
      readAt: Date.now(),
    }
    await show()
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't parse quota/)
    expect(screen.getByRole('alert').textContent).toMatch(/Jul 28, 9pm \(Europe\/Berlin\)/)
    expect(screen.queryByRole('img')).toBeNull()
    // The alert stands on its own rather than being quietly swapped for a plain figure — but the
    // windows Claude Code did report are still data, not a fallback, and still list.
    expect(screen.getByText('Current session')).toBeTruthy()
    expect(screen.queryByLabelText('Unattended work stops at')).toBeNull()
  })

  test('a readout it could not parse keeps the bar and dates it, rather than replacing it (#960)', async () => {
    // The poller now survives an unrecognized answer, so the earlier reading is still on screen.
    // It has to say how old it is: an undated bar claims to be current.
    view = { ...reading(20), unavailable: 'unrecognized', readAt: Date.now() - 90 * 60 * 1000 }
    await show()
    expect(screen.getByRole('img')).toBeTruthy()
    expect(screen.getByText(/from the reading before it/)).toBeTruthy()
    expect(screen.getByText(/Last read/)).toBeTruthy()
  })

  test('an unrecognized readout with nothing retained says it will try again (#960)', async () => {
    view = { windows: [], unavailable: 'unrecognized' }
    await show()
    // It used to read as terminal ("the boundary is off"), which is what made this look reverted.
    expect(screen.getByText(/Trying again shortly/)).toBeTruthy()
  })

  // The bug this test exists for: the slider used to be bound straight to the polled value, which
  // only refreshes every 30s. Each keypress recomputed from the same stale number and the thumb
  // snapped back, so twenty presses of an arrow key moved the limit by one.
  test('successive moves accumulate instead of snapping back to the last poll, and one write goes out once the handle rests (#960)', async () => {
    view = reading(20, 0)
    await show()
    const slider = screen.getByLabelText('Unattended work stops at') as HTMLInputElement
    const boundaryPercent = (4 / 7) * 100
    fireEvent.change(slider, { target: { value: String(boundaryPercent + 5) } })
    expect(Number(slider.value)).toBeCloseTo(boundaryPercent + 5, 5)
    fireEvent.change(slider, { target: { value: String(boundaryPercent + 12) } })
    expect(Number(slider.value)).toBeCloseTo(boundaryPercent + 12, 5)
    await waitFor(() => expect(sendSpendOffset).toHaveBeenCalledWith(12))
    // A drag is many changes; each save is a command per project, so only the resting value goes out.
    expect(sendSpendOffset).toHaveBeenCalledTimes(1)
  })

  test('a save that fails says why, and the handle goes back to the value the module reads (#960)', async () => {
    sendSpendOffset.mockImplementation(async () => ({ ok: false, error: 'gemstack: not inside a git repository' }))
    view = reading(20, 0)
    await show()
    const slider = screen.getByLabelText('Unattended work stops at') as HTMLInputElement
    const boundaryPercent = (4 / 7) * 100
    fireEvent.change(slider, { target: { value: String(boundaryPercent + 10) } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not saved: gemstack: not inside a git repository/))
    expect(Number(slider.value)).toBeCloseTo(boundaryPercent, 5)
  })

  test('the drawn limit follows the handle, not the poll (#960)', async () => {
    view = reading(20, 0)
    await show()
    const slider = screen.getByLabelText('Unattended work stops at') as HTMLInputElement
    const boundaryPercent = (4 / 7) * 100
    // At rest the handle sits exactly on the boundary tick — one mark, not two.
    expect(Number(slider.value)).toBeCloseTo(boundaryPercent, 5)
    fireEvent.change(slider, { target: { value: String(boundaryPercent + 20) } })
    // Moved, without waiting for the daemon to confirm it via the next poll.
    expect(Number(slider.value)).toBeCloseTo(boundaryPercent + 20, 5)
  })

  // The handle is valued 0-100, the same scale as the fill and boundary beneath it (#960 Edit) —
  // a native thumb's position is always (value - min) / (max - min) of the box, so min/max have to
  // stay 0/100 for the thumb to land where the boundary tick does. That leaves the ±50 the offset
  // is allowed to mean unenforced by the input itself, so the change handler has to clamp it.
  test('dragged to the far end of the bar, the stored offset still clamps to +50 (#960 Edit)', async () => {
    // A boundary early in the week, so the bar's far (right) end is more than 50 points away.
    view = readingAt(1, 20, 0)
    await show()
    fireEvent.change(screen.getByLabelText('Unattended work stops at'), { target: { value: '100' } })
    await waitFor(() => expect(sendSpendOffset).toHaveBeenLastCalledWith(50))
  })

  test('dragged to the near end of the bar, the stored offset still clamps to -50 (#960 Edit)', async () => {
    // A boundary late in the week, so the bar's near (left) end is more than 50 points away.
    view = readingAt(6, 20, 0)
    await show()
    fireEvent.change(screen.getByLabelText('Unattended work stops at'), { target: { value: '0' } })
    await waitFor(() => expect(sendSpendOffset).toHaveBeenLastCalledWith(-50))
  })

  test('the bar splits into used and projected segments, not a used amount plus a floating mark (#960 Edit)', async () => {
    view = reading(20, 15) // boundary 57%, offset 15 -> limit 72%
    await show()
    const bar = screen.getByRole('img')
    const [used, projected] = bar.querySelectorAll<HTMLElement>(':scope > div')
    expect(used!.style.width).toBe('20%')
    expect(projected!.style.left).toBe('20%')
    expect(parseFloat(projected!.style.width)).toBeCloseTo(52.142857, 4) // 72% limit - 20% used
    expect(projected!.className).toMatch(/opacity-35/)
    // One bar, not two pills glued together: neither segment rounds its own corners — only the
    // track's own overflow-hidden shapes the ends.
    expect(used!.className).not.toMatch(/rounded/)
    expect(projected!.className).not.toMatch(/rounded/)
  })

  test('nothing left to project once the limit has already been reached, so no dimmed segment is drawn', async () => {
    view = reading(80, -50) // boundary 57% - 50 = limit 7%, already well below the 80% used
    await show()
    const bar = screen.getByRole('img')
    // Used, the day delimiters, and the boundary line — no dimmed segment, since there is no room.
    expect(bar.querySelectorAll('.opacity-35')).toHaveLength(0)
  })

  test('names whether autonomous AI currently has room to spend (#960 Edit)', async () => {
    view = reading(20, 15) // limit 72% > 20% used: room left
    const { container } = await show()
    expect(container.querySelector('em')?.textContent).toBe('enabled')
    expect(screen.getByText(/move slider to the left to disable/)).toBeTruthy()
  })

  test('names autonomous AI as disabled once the knob leaves no room (#960 Edit)', async () => {
    view = reading(80, -50) // limit 7% < 80% used: no room
    const { container } = await show()
    expect(container.querySelector('em')?.textContent).toBe('disabled')
    expect(screen.getByText(/move slider to the right to enable/)).toBeTruthy()
  })

  test('the enabled status has its own tooltip naming what enabled means (#960 Edit)', async () => {
    view = reading(20, 15) // room left: enabled
    await show()
    await hoverTooltip(screen.getByText('enabled', { selector: 'em' }).closest('span')!)
    expect(
      screen.getByText(
        'Autonomous AI enabled means that unattended work may start on its own while the account is under the line.',
      ),
    ).toBeTruthy()
  })

  test('the disabled status has its own tooltip naming what disabled means (#960 Edit)', async () => {
    view = reading(80, -50) // no room: disabled
    await show()
    await hoverTooltip(screen.getByText('disabled', { selector: 'em' }).closest('span')!)
    expect(
      screen.getByText(
        'Autonomous AI disabled means that no agent starts on its own — every new agentic work is triggered by you manually.',
      ),
    ).toBeTruthy()
  })

  test('no warning while the limit sits on, or only just past, the boundary (#960 Edit)', async () => {
    view = reading(20, 0) // limit sits exactly on the boundary: not past it yet
    await show()
    expect(screen.queryByText(/Eager consumption/)).toBeNull()
  })

  test('no warning for an overshoot smaller than a full day above the boundary (#960 Edit)', async () => {
    // Boundary at 57.14%, offset 10: 67.14%, short of the ~14.29-point (one day) threshold.
    view = reading(20, 10)
    await show()
    expect(screen.queryByText(/Eager consumption/)).toBeNull()
  })

  test('warns once the offset clears a full day above the boundary (#960 Edit)', async () => {
    // Boundary at 57.14%, offset 20: 77.14%, clearing the ~14.29-point (one day) threshold — a
    // 20-point offset over a 7-day week is 1.4 days, floored to "1 day".
    view = reading(20, 20)
    await show()
    const warning = screen.getByText('⚠️ Eager consumption')
    await hoverTooltip(warning)
    expect(screen.getByText("Autonomous AI will spend tokens 1 day faster than the week's pace allows")).toBeTruthy()
  })

  test('the eager-consumption tooltip names the knob\'s own actual deviation, not a fixed figure (#960 Edit)', async () => {
    // Offset 40 over a 7-day week is 2.8 days, floored to "2 days" — distinct from the other test's
    // "1 day" at offset 20, proving the tooltip reads the real deviation rather than a hardcoded one.
    view = reading(20, 40)
    await show()
    await hoverTooltip(screen.getByText('⚠️ Eager consumption'))
    expect(screen.getByText("Autonomous AI will spend tokens 2 days faster than the week's pace allows")).toBeTruthy()
  })

  test('the warning sits beside the enabled/disabled status, not stacked below it (#960 Edit)', async () => {
    view = reading(20, 20)
    const { container } = await show()
    const em = container.querySelector('em')
    const row = em?.closest('div')
    expect(row?.textContent).toMatch(/enabled/)
    expect(row?.querySelectorAll('svg.lucide-circle-help').length).toBeGreaterThan(0)
  })

  test('one bar, not two: the handle is drawn on the week track itself (#960 Edit)', async () => {
    view = reading(20, 0)
    const { container } = await show()
    // A single native range input, and it lives inside the same card section as the week track —
    // not as a full-width slider of its own underneath it.
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(1)
    const bar = screen.getByRole('img')
    const slider = screen.getByLabelText('Unattended work stops at')
    expect(bar.parentElement).toBe(slider.parentElement)
  })

  test('names the reset as a weekday and a time, not a date the bar already implies (#960 Edit)', async () => {
    view = reading(20)
    await show()
    expect(screen.getByText(/^Resets /)).toBeTruthy()
    expect(screen.queryByText('Under the line, with room to spend.')).toBeNull()
  })

  test('the main figure reads a pace deviation as a duration, not a percentage of the week (#960 Edit)', async () => {
    // 20% of the week used against a 57% (day 4/7) pace: 2.6 days behind, floored to 2d.
    view = reading(20)
    await show()
    expect(mainFigureTrigger().textContent).toBe("You are 2d under the week's pace")
    expect(screen.queryByText('20% used')).toBeNull()
    expect(screen.queryByText(/^-?\d+% used$/)).toBeNull()
  })

  test('the duration is bold and coloured to match the bar\'s own tone, the label plain (#960 Edit)', async () => {
    view = reading(20) // under-consuming: the bar's tone (and so the duration) reads green
    await show()
    const trigger = mainFigureTrigger()
    expect(trigger.className).not.toMatch(/font-medium/)
    const duration = trigger.querySelector('span')!
    expect(duration.textContent).toBe('2d')
    expect(duration.className).toMatch(/font-medium/)
    expect(duration.className).toMatch(/text-success/)
  })

  test('reads over-consuming (zero duration) exactly on the boundary\'s own pace', async () => {
    view = reading((4 / 7) * 100)
    await show()
    expect(mainFigureTrigger().textContent).toBe("You are 0s over the week's pace")
  })

  test('reads over-consuming with a duration when ahead of pace', async () => {
    // Boundary at day 1 of 7 (~14.3%), 60% used: well over three sevenths of the week ahead.
    view = readingAt(1, 60, 0)
    await show()
    expect(mainFigureTrigger().textContent).toMatch(/^You are \d+d over the week's pace$/)
  })

  test('the footer also says what was spent, as quota time (#1367)', async () => {
    // Half the week used is half the week's allowance consumed — the same unit as the pace figure
    // beside it, rather than a percentage a reader has to convert.
    view = reading(50)
    await show()
    expect(screen.getByText(/^Resets /).closest('p')!.textContent).toMatch(/3d spent/)
  })

  test('the footer says consumption as a share of the pace, not of the week (#1367)', async () => {
    // Boundary at day 4 of 7 (~57%), 60% used: a little over pace, so a little over 100%.
    view = reading(60)
    await show()
    expect(screen.getByText(/^Resets /).closest('p')!.textContent).toMatch(/105% of pace/)
  })

  test('the pace share is coloured to match the bar, since it is the same comparison (#1367)', async () => {
    view = reading(20) // well under pace: the bar reads green, and so does this
    await show()
    const share = [...screen.getByText(/^Resets /).closest('p')!.querySelectorAll('span')].find(s =>
      /^\d+%$/.test(s.textContent ?? ''),
    )!
    expect(share.className).toMatch(/text-success/)
  })

  test('no pace share at the very start of the week, rather than an infinite one (#1367)', async () => {
    // Day zero: nothing is allowed yet, so every amount is infinitely above the allowance.
    view = readingAt(0, 3, 0)
    await show()
    expect(screen.getByText(/^Resets /).closest('p')!.textContent).not.toMatch(/of pace/)
  })

  test('the main figure has its own tooltip naming the deviation against the quota boundary (#960 Edit)', async () => {
    view = reading(20)
    await show()
    await hoverTooltip(mainFigureTrigger())
    expect(screen.getByText(/You are 2 days below the quota boundary\.\s*You're under-consuming: you spend slower/)).toBeTruthy()
  })

  test('the legend names the projected segment and gives the quota boundary a tooltip (#960 Edit)', async () => {
    view = reading(20)
    const { container } = await show()
    expect(screen.getByText('Budget for Autonomous AI')).toBeTruthy()
    expect(screen.getByText('Quota boundary')).toBeTruthy()
    expect(container.querySelector('svg.lucide-circle-help')).toBeTruthy()
  })

  test('the quota boundary tooltip explains itself in its own paragraph, and ends on a fun fact (#960 Edit)', async () => {
    view = reading(20)
    await show()
    await hoverTooltip(screen.getByText('Quota boundary'))
    expect(
      screen.getByText("If your usage matches the quota boundary, then you're spending exactly what the week's pace allows."),
    ).toBeTruthy()
    expect(
      screen.getByText('Fun fact: the quota boundary is shown exactly at the current time in the week usage bar above.'),
    ).toBeTruthy()
  })

  test('the reset tooltip trigger carries no underline (#960 Edit)', async () => {
    view = reading(20)
    await show()
    const trigger = screen.getByText(/^Resets /)
    expect(trigger.className).not.toMatch(/underline/)
  })

  test('every window Claude Code reports gets its own line, reachable through "show all limits" (#960 Edit)', async () => {
    view = reading(20)
    view.windows.push({ label: 'Current week (Fable)', kind: 'week-model', percentUsed: 12, resetsAtText: 'Jul 28 at 7pm' })
    await show()
    await hoverTooltip(screen.getByText('Show all limits'))
    const rows = screen.getAllByText(/Current (session|week)/).map(el => el.textContent)
    expect(rows).toEqual(['Current week (all models)', 'Current session', 'Current week (Fable)'])
  })

  test('"show all limits" renders as a real table, not flex rows that drift out of alignment (#960 Edit)', async () => {
    view = reading(20)
    view.windows.push({ label: 'Current week (Fable)', kind: 'week-model', percentUsed: 12, resetsAtText: 'Jul 28 at 7pm' })
    await show()
    await hoverTooltip(screen.getByText('Show all limits'))
    const tooltip = screen.getByRole('tooltip')
    const table = tooltip.querySelector('table')!
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('tr')).toHaveLength(3)
    for (const row of table.querySelectorAll('tr')) expect(row.querySelectorAll('td')).toHaveLength(2)
  })

  test('the legend and the enabled/disabled status share one row, the warning between them (#960 Edit)', async () => {
    view = reading(20, 20) // limit a full day past the boundary, so the warning shows too
    await show()
    const em = screen.getByText('enabled', { selector: 'em' })
    const legend = screen.getByText('Used')
    // Same row: the legend and the status line share the same immediate row container.
    const row = em.closest('.justify-between')!
    expect(legend.closest('.justify-between')).toBe(row)
    // The warning sits to the left of the status, both within the row's own right-hand group.
    const warning = screen.getByText('⚠️ Eager consumption')
    const statusGroup = em.closest('span')!.parentElement!
    expect(statusGroup.contains(warning)).toBe(true)
    // DOCUMENT_POSITION_FOLLOWING (4) on the status span means the warning precedes it.
    expect(warning.compareDocumentPosition(em.closest('span')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('"show all limits" is absent when there is nothing else to show', async () => {
    view = { ...reading(20), windows: reading(20).windows.filter(w => w.kind === 'week') }
    await show()
    expect(screen.queryByText('Show all limits')).toBeNull()
  })

  test('the roadmap-spend toggle is gone from this panel (#960 Edit)', async () => {
    view = reading(20)
    await show()
    expect(screen.queryByText(/Spend what's left on the roadmap/)).toBeNull()
  })
})
