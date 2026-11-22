import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { Waiting } from '../../src/index.js'

// The project has a document, and the page must still show none: the documents are the side
// panel's "Docs" tab. The read is stubbed to prove the page does not even ask for them.
const onDocs = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDocs }))

// The sections are tested on their own; here they are stand-ins.
vi.mock('./ProjectActions.js', () => ({ ProjectActions: () => <h1>New agent session</h1> }))
vi.mock('./ProjectErrorBanner.js', () => ({ ProjectErrorBanner: () => null }))
vi.mock('./StartAgentForm.js', () => ({ StartAgentForm: () => <div>start form</div> }))
vi.mock('./WaitingList.js', () => ({ WaitingList: ({ items }: { items: unknown[] }) => <div>{items.length} rows</div>, holdsBack: (items: unknown[]) => items.length > 6 }))

vi.mock('./FolderBehind.js', () => ({ FolderBehindLine: ({ projectId }: { projectId: string }) => <div>folder of {projectId} behind</div> }))

const { ProjectHome } = await import('./ProjectHome.js')

const WAITS: Waiting = { projectId: 'p1', projectName: 'p1', kind: 'waiting', module: 'ask', scope: 'run', run: 'r1', id: 'r1:q1', words: 'Needs answer', title: 'Auth store', detail: 'Cache it?', mark: 'question' }

beforeEach(() => {
  onDocs.mockReset().mockResolvedValue([{ name: 'PLAN.md', content: '# the plan' }])
})

afterEach(cleanup)

describe('ProjectHome', () => {
  test('its top bar names it, no question stands over the box, and it shows the launcher and what waits on you, and no Docs section', async () => {
    render(
      <ProjectHome
        projectId="p1"
        waiting={[WAITS]}
        files={[]}
        context={new Set()}
        addContext={() => {}}
        removeContext={() => {}}
        toggleContext={() => {}}
        onOpenAgent={() => {}}
        projects={[]}
        onPickProject={() => {}}
        onProjectAdded={() => {}}
      />,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // What waits comes first and the box is drawn last, at the bottom, on every screen: no room is
    // kept above the box to stand it at 38% of the page while something waits.
    expect(screen.getByRole('region', { name: 'Waiting on you' })).toBeTruthy()
    // The bar names the page; the box says what it is for: no question over it (his pick).
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['New agent session'])
    expect(screen.getByRole('heading', { name: 'Waiting on you · 1' })).toBeTruthy()
    const questions = screen.getByText('1 rows')
    const form = screen.getByText('start form')
    expect(form.parentElement!.className.split(' ')).toContain('order-last')
    expect(document.querySelector('.md\\:basis-\\[38\\%\\]')).toBeNull()
    // The top bar lies over the page's top, see-through and blurred, short of the list's scroll bar,
    // and the list, first, starts under it.
    expect(screen.getByTestId('home-top').className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'top-0', 'left-0', 'right-2.5', 'z-20', 'bg-background/80', 'backdrop-blur-md']))
    expect(screen.getByTestId('home-room').style.getPropertyValue('--home-top')).toBe('0px')
    expect(questions.closest('.max-w-3xl')!.className.split(' ')).toContain('pt-(--home-top)')
    // The rows scroll in the chat's column; the box is outside what scrolls, so it stays in place.
    expect(questions.closest('.max-w-3xl')).toBeTruthy()
    expect(form.closest('[data-slot="scroll-area"]')).toBeNull()
    expect(questions.closest('[data-slot="scroll-area"]')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Docs' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Docs' })).toBeNull()
    expect(screen.queryByText('PLAN.md')).toBeNull()
    expect(onDocs).not.toHaveBeenCalled()
  })

  test('the line for a folder behind its remote is the project’s, under what waits on you', () => {
    render(<ProjectHome projectId="p1" waiting={[WAITS]} files={[]} context={new Set()} addContext={() => {}} removeContext={() => {}} toggleContext={() => {}} onOpenAgent={() => {}} projects={[]} onPickProject={() => {}} onProjectAdded={() => {}} />)
    const line = screen.getByText('folder of p1 behind')
    const waiting = screen.getByRole('region', { name: 'Waiting on you' })
    expect(waiting.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.parentElement).toBe(waiting.parentElement)
  })

  test('nothing waits: no section, no heading', () => {
    render(<ProjectHome projectId="p1" waiting={[]} files={[]} context={new Set()} addContext={() => {}} removeContext={() => {}} toggleContext={() => {}} onOpenAgent={() => {}} projects={[]} onPickProject={() => {}} onProjectAdded={() => {}} />)
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull()
    expect(screen.queryByText(/Waiting on you/)).toBeNull()
  })
})
