import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// The project has a document, and the page must still show none: the documents are the side
// panel's "Docs" tab. The read is stubbed to prove the page does not even ask for them.
const onDocs = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDocs }))

// The sections are tested on their own; here they are stand-ins.
vi.mock('./ProjectActions.js', () => ({ ProjectActions: ({ onOpenSkills }: { onOpenSkills?: () => void }) => <button onClick={onOpenSkills}>Skills…</button> }))
vi.mock('./ProjectErrorBanner.js', () => ({ ProjectErrorBanner: () => null }))
vi.mock('./ProjectSkills.js', () => ({
  ProjectSkillsLine: ({ door }: { door?: { open: boolean; onClose: () => void } }) => (door?.open ? <button onClick={door.onClose}>close the skills list</button> : <div>skills line</div>),
}))
vi.mock('./StartAgentForm.js', () => ({ StartAgentForm: () => <div>start form</div> }))
vi.mock('./AgentOverview.js', () => ({ AgentOverview: () => <div>overview</div> }))
vi.mock('./OpenQuestions.js', () => ({ OpenQuestions: () => <div>open questions</div> }))

const { ProjectHome } = await import('./ProjectHome.js')

beforeEach(() => {
  onDocs.mockReset().mockResolvedValue([{ name: 'PLAN.md', content: '# the plan' }])
})

afterEach(cleanup)

describe('ProjectHome', () => {
  test('it shows the launcher and the open questions, and no Docs section', async () => {
    render(
      <ProjectHome
        projectId="p1"
        events={[]}
        files={[]}
        context={new Set()}
        addContext={() => {}}
        removeContext={() => {}}
        toggleContext={() => {}}
        onOpenAgent={() => {}}
      />,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // The waiting rows come first and the box to start an agent last, as on an agent's page.
    const questions = screen.getByText('open questions')
    const form = screen.getByText('start form')
    expect(questions.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The rows scroll in the chat's column; the box is outside what scrolls, so it stays in place.
    expect(questions.closest('.max-w-3xl')).toBeTruthy()
    expect(form.closest('[data-slot="scroll-area"]')).toBeNull()
    expect(questions.closest('[data-slot="scroll-area"]')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Docs' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Docs' })).toBeNull()
    expect(screen.queryByText('PLAN.md')).toBeNull()
    expect(onDocs).not.toHaveBeenCalled()
  })

  test('"Skills…" in the project\'s menu opens the skills list, and closing the list lets it be opened again', async () => {
    render(<ProjectHome projectId="p1" events={[]} files={[]} context={new Set()} addContext={() => {}} removeContext={() => {}} toggleContext={() => {}} onOpenAgent={() => {}} />)
    expect(screen.getByText('skills line')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    fireEvent.click(screen.getByRole('button', { name: 'close the skills list' }))
    expect(screen.getByText('skills line')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    expect(screen.getByRole('button', { name: 'close the skills list' })).toBeTruthy()
  })

  test('a skills list asked for in one project does not open in the next project picked', async () => {
    const home = (projectId: string) => <ProjectHome projectId={projectId} events={[]} files={[]} context={new Set()} addContext={() => {}} removeContext={() => {}} toggleContext={() => {}} onOpenAgent={() => {}} />
    const { rerender } = render(home('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    expect(screen.getByRole('button', { name: 'close the skills list' })).toBeTruthy()
    rerender(home('p2'))
    expect(screen.getByText('skills line')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'close the skills list' })).toBeNull()
  })
})
