import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleAgent } from '@openagt/dashboard/module'
import { planTicketPrompt, workOnTicketPrompt } from '../src/module.js'
import { fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { TicketPlanPage } from './TicketPlanPage.js'
import { TicketDetailPage } from './TicketDetailPage.js'
import { openMenu } from '../../dashboard/dashboard/test-utils.js'

afterEach(() => {
  cleanup()
  // Every story reads the same ticket: none opens on the one before's.
  forgetRemembered()
  localStorage.clear()
})

const SLUG = '2026-07-20_do-the-thing.md'
const TICKET = { file: SLUG, title: 'Do the thing', summary: '', date: '2026-01-01T00:00:00.000Z', planned: true, content: '# Do the thing\n' }
const PLAN = 'Effort: 2\n\n# [Plan] Do the thing\n\n## The plan\n\nDo it in two steps.'

/** The page over a `show` answer carrying `plan` (or not), and the project's runs. */
const render = (plan: string | undefined, agents: ModuleAgent[] = []): FakeHost => {
  const host = fakeHost({ p1: { [`show ${SLUG} --local`]: { ok: true, ticket: TICKET, ...(plan === undefined ? {} : { plan }) } } }, { p1: agents })
  renderWithHost(<TicketPlanPage projectId="p1" slug={SLUG} />, host)
  return host
}

describe('TicketPlanPage (#685)', () => {
  test('reads the plan with the ticket, by its slug, and renders its markdown', async () => {
    const host = render(PLAN)
    await waitFor(() => expect(host.runCommand).toHaveBeenCalledWith('p1', ['show', SLUG, '--local']))
    expect(await screen.findByText('The plan')).toBeTruthy()
    expect(screen.getByText('Do it in two steps.')).toBeTruthy()
    // The breadcrumb names the ticket by its title, then the plan; the tab says which page this is.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('TicketsDo the thingPlan')
    expect(screen.getByRole('tab', { name: 'Plan', selected: true })).toBeTruthy()
  })

  test('the head is the ticket tab\'s: More offers Edit ticket, which opens the ticket\'s page on its edit form', async () => {
    const host = render(PLAN)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    expect(host.openPage).toHaveBeenCalledWith('tickets', [SLUG], 'p1', { beside: true })
    cleanup()
    renderWithHost(<TicketDetailPage projectId="p1" slug={SLUG} />, host)
    expect(await screen.findByRole('heading', { name: 'Edit ticket' })).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Do the thing')
  })

  // The shell carries a return across pages opened beside each other (its App tests): from either
  // of a ticket's pages, the list the ticket was opened from is reached by Back, as it was left.
  test('the ticket\'s Plan tab opens beside the ticket, and its crumb "Tickets" goes back to the list', async () => {
    const host = fakeHost({ p1: { [`show ${SLUG} --local`]: { ok: true, ticket: TICKET, plan: PLAN } } })
    renderWithHost(<TicketDetailPage projectId="p1" slug={SLUG} />, host)
    fireEvent.click(await screen.findByRole('tab', { name: 'Plan' }))
    expect(host.openPage).toHaveBeenCalledWith('tickets', [SLUG, 'plan'], 'p1', { beside: true })
    cleanup()
    renderWithHost(<TicketPlanPage projectId="p1" slug={SLUG} />, host)
    fireEvent.click(await screen.findByRole('button', { name: 'Tickets' }))
    expect(host.backToPage).toHaveBeenCalledWith('tickets')
  })

  test.each([
    ['More → Edit ticket, then Cancel', async () => {
      await openMenu(await screen.findByRole('button', { name: 'More' }))
      fireEvent.click(await screen.findByText('Edit ticket'))
    }, () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['crumb to the ticket', async () => fireEvent.click(await screen.findByRole('button', { name: 'Do the thing' })), () => {}],
  ])('the Plan tab\'s %s opens the ticket beside it, whose "Tickets" goes back to the list', async (_, leave, onTicket) => {
    const host = fakeHost({ p1: { [`show ${SLUG} --local`]: { ok: true, ticket: TICKET, plan: PLAN } } })
    renderWithHost(<TicketPlanPage projectId="p1" slug={SLUG} />, host)
    await leave()
    expect(host.openPage).toHaveBeenCalledWith('tickets', [SLUG], 'p1', { beside: true })
    cleanup()
    renderWithHost(<TicketDetailPage projectId="p1" slug={SLUG} />, host)
    await screen.findByRole('button', { name: 'Tickets' })
    onTicket()
    fireEvent.click(screen.getByRole('button', { name: 'Tickets' }))
    expect(host.backToPage).toHaveBeenCalledWith('tickets')
  })

  test('a ticket with no plan says so in one line, under the head whose press has an agent write it', async () => {
    const host = fakeHost({ p1: { [`show ${SLUG} --local`]: { ok: true, ticket: { ...TICKET, planned: false } } } }, { p1: [] })
    renderWithHost(<TicketPlanPage projectId="p1" slug={SLUG} />, host)
    expect(await screen.findByText('No plan yet.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Plan now' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }))
    await waitFor(() => expect(host.startRun).toHaveBeenCalledWith('p1', planTicketPrompt(SLUG)))
  })

  test('a ticket an agent holds, with no plan, says so and offers no press to plan or work it', async () => {
    const held = fakeHost({ p1: { [`show ${SLUG} --local`]: { ok: true, ticket: { ...TICKET, planned: false, locked: true } } } }, { p1: [] })
    renderWithHost(<TicketPlanPage projectId="p1" slug={SLUG} />, held)
    expect(await screen.findByText('No plan yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /plan now|start work/i })).toBeNull()
  })

  test('a plan with a known author names its session and opens it (#1511)', async () => {
    const host = render(PLAN, [{ id: 'run-7', ask: planTicketPrompt(SLUG), status: 'done', startedAt: '2026-07-21T00:00:00.000Z', title: 'Plan the thing' }])
    const runs = within((await screen.findByText('Runs on this ticket')).parentElement!)
    expect(runs.getByText('Plan the thing').getAttribute('title')).toMatch(/^Wrote its plan/)
    fireEvent.click(runs.getByRole('button', { name: 'Plan the thing' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-7')
  })

  test('an author still running is said to be writing it, and opened the same way (#1511)', async () => {
    const host = render(PLAN, [{ id: 'run-8', ask: planTicketPrompt(SLUG), status: 'running', startedAt: '2026-07-21T00:00:00.000Z' }])
    const runs = within((await screen.findByText('Runs on this ticket')).parentElement!)
    const [press] = runs.getAllByRole('button')
    expect(press!.querySelector('[title]')?.getAttribute('title')).toMatch(/^Writing its plan/)
    fireEvent.click(press!)
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-8')
  })

  test('a plan nobody on record wrote shows no resume control (#1511)', async () => {
    render(PLAN, [{ id: 'run-9', ask: 'Work on tickets/other.md', status: 'done', startedAt: '2026-07-21T00:00:00.000Z' }])
    expect(await screen.findByText('The plan')).toBeTruthy()
    expect(screen.queryByText('Runs on this ticket')).toBeNull()
  })

  test('the work starts from where its plan is read, now or queued; never on a ticket an agent holds', async () => {
    const host = render(PLAN)
    expect(await screen.findByText('The plan')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Plan now' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await waitFor(() => expect(host.startRun).toHaveBeenCalledWith('p1', workOnTicketPrompt(SLUG)))
    cleanup()
    const held = fakeHost({ p1: { [`show ${SLUG} --local`]: { ok: true, ticket: { ...TICKET, locked: true }, plan: PLAN } } }, { p1: [] })
    renderWithHost(<TicketPlanPage projectId="p1" slug={SLUG} />, held)
    expect(await screen.findByText('The plan')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
  })

  test('Back returns to the list, the module\'s own page', async () => {
    const host = render(PLAN)
    fireEvent.click(await screen.findByRole('button', { name: /tickets/i }))
    expect(host.backToPage).toHaveBeenCalledWith('tickets')
  })
})
