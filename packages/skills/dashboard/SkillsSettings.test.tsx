import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { ProjectSkills } from './calls.js'
import { SkillsSettings } from './SkillsSettings.js'

// The module's own call as a test answers it: each project's skills, or why they could not be read.

const project = (id: string) => ({ id, name: id, remote: 'github.com/me/project' })

function render(projects: ReturnType<typeof project>[], answers: Record<string, ProjectSkills | string>) {
  const call = vi.fn(async (projectId: string, name: string): Promise<ModuleCallResult> => {
    const answer = name === 'projectSkills' ? answers[projectId] : undefined
    if (answer === undefined) return { ok: false, error: `no answer for ${name} in ${projectId}` }
    return typeof answer === 'string' ? { ok: false, error: answer } : { ok: true, output: answer }
  })
  renderWithHost(<SkillsSettings projects={projects} />, fakeHost('@openagt/skills', { call }))
  return call
}

afterEach(cleanup)

describe('Settings › Skills', () => {
  test("lists the project's own skills, each with what it says of itself: a command by what is typed, one not yet where runs start from said so; and no press that would change one", async () => {
    render([project('shop')], {
      shop: {
        skills: [
          { name: 'deploy', description: 'Ship it to production, then watch the logs.', command: true },
          { name: 'lint', command: false, waiting: true },
          { name: 'tickets', description: 'Where the tickets live.', command: false },
        ],
        startBranch: 'main',
      },
    })
    const list = await screen.findByRole('list', { name: 'Skills of shop' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual(['deployShip it to production, then watch the logs./deploy', 'lintNot on main yet', 'ticketsWhere the tickets live.'])
    expect(screen.getByText(/OpenAgent never adds or changes them/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  test('a project with none says so; one that could not be read says why, beside the others', async () => {
    render([project('shop'), project('blog'), project('docs')], {
      shop: { skills: [], startBranch: 'main' },
      blog: 'EACCES: permission denied',
      docs: { skills: [{ name: 'write', command: false }] },
    })
    expect(await screen.findByText('shop keeps no skills of its own.')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toBe('The skills of blog could not be read: EACCES: permission denied')
    // With several projects, each one's under its name.
    expect(screen.getAllByRole('heading').map(heading => heading.textContent)).toEqual(['shop', 'blog', 'docs'])
    expect(within(await screen.findByRole('list', { name: 'Skills of docs' })).getAllByRole('listitem').map(row => row.textContent)).toEqual(['write'])
  })

  test('with no project there is nothing to list', () => {
    const call = render([], {})
    expect(document.body.textContent).toBe('')
    expect(call).not.toHaveBeenCalled()
  })
})
