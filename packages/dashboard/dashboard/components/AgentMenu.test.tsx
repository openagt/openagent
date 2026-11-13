import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'
import { forgetRemembered } from '../lib/use-async.js'

vi.mock('../rpc/agents.js', () => ({ onAgentsList: async () => ({ agents: [{ id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {}, projectSkills: true }, { id: 'reviewer', name: 'Reviewer', skills: ['ask'], accounts: {}, projectSkills: true }], skills: [], claude: [], codex: [] }), onAgentLogins: async () => [] }))
// What each item's hover says is on the page as a line, and its trigger is what holds the button.
vi.mock('./ui/tooltip.js', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => cloneElement(trigger, { 'data-hover': true } as never, children),
  TooltipContent: ({ children }: { children: ReactNode }) => <span role="tooltip">{children}</span>,
}))

const { AgentOff } = await import('./AgentMenu.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe("a session's agent under the box, as words", () => {
  test('the agent by its name once the agents are read, as words the keyboard stops on, with what its hover says; nothing before', async () => {
    const { container } = render(<AgentOff agent="reviewer" />)
    expect(container.textContent).toBe('')
    const said = (await screen.findByText('Reviewer')).closest<HTMLElement>('[data-hover]')!
    expect(said.tabIndex).toBe(0)
    expect(screen.queryByRole('button')).toBeNull()
    // A screen reader hears what it is and why it stays, as the launcher's says "Agent: Default".
    expect(said.textContent).toBe('Agent: Reviewer. This session is on the agent Reviewer: its skills and accounts')
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the agent Reviewer: its skills and accounts')
  })

  test('a record that names no agent is on the default, said as the launcher says it; one this computer lacks, by its id', async () => {
    const { rerender } = render(<AgentOff agent={undefined} />)
    await screen.findByText('Default')
    rerender(<AgentOff agent="elsewhere-made" />)
    expect(screen.getByText('elsewhere-made')).toBeTruthy()
  })
})
