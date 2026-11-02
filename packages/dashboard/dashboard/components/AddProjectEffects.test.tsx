import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AddProjectEffects } from './AddProjectEffects.js'

afterEach(cleanup)

describe('AddProjectEffects', () => {
  test('says what adding a project does to the folder: no commit on the person’s branch, nothing pushed, what OpenAgent keeps there, where the records stay, the basic skills an agent gets, and the empty first commit of a folder or repository that has none', () => {
    const { container } = render(<AddProjectEffects />)
    const text = container.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('Adding a project lets agents work in its folder. Adding it:')
    expect(text).toContain('makes no commit on your branch and pushes nothing')
    expect(text).toContain('lets OpenAgent keep its own files there, in hidden folders (.openagent, .branches, .agent-runner), and the agents’ records on a local branch agent-data')
    expect(text).toContain('keeps the records on this machine, unless you choose to share them')
    expect(text).toContain('gives each agent four basic skills in its own copy, hidden from git: branches, logs, question, and github when the project is on GitHub')
    expect(text).toContain('Agents work in their own copies, on their own branches. Your files and your branch stay as they are.')
    expect(text).toContain('A folder with no git, or a repository with no commit yet, gets one empty first commit.')
    // Four effects, as a list.
    expect(container.querySelectorAll('li')).toHaveLength(4)
  })
})
