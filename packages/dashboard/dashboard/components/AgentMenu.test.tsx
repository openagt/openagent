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

describe("a session's agent under the box, off", () => {
  test('the agent by its name once the agents are read, off, with what its hover says; nothing before', async () => {
    const { container } = render(<AgentOff agent="reviewer" />)
    expect(container.querySelector('button')).toBeNull()
    const item = (await screen.findByRole('button', { name: 'Reviewer' })) as HTMLButtonElement
    expect(item.disabled).toBe(true)
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the agent Reviewer: its skills and accounts')
  })

  test('a record that names no agent is on the default, said as the launcher says it; one this computer lacks, by its id', async () => {
    const { rerender } = render(<AgentOff agent={undefined} />)
    await screen.findByRole('button', { name: 'Default' })
    rerender(<AgentOff agent="elsewhere-made" />)
    expect(screen.getByRole('button', { name: 'elsewhere-made' })).toBeTruthy()
  })
})
