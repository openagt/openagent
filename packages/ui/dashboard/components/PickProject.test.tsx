import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProjectSummary } from '../../src/index.js'
import { PickProject } from './PickProject.js'

afterEach(cleanup)

describe('a project page with every project picked', () => {
  test('says why it asks for one, and a press picks it', () => {
    const onPick = vi.fn()
    const projects = [{ id: 'p1', name: 'shop' }, { id: 'p2', name: 'blog' }] as ProjectSummary[]
    render(<PickProject words="One project at a time. Pick a project." projects={projects} onPick={onPick} />)
    expect(document.body.textContent).toContain('One project at a time. Pick a project.')
    fireEvent.click(screen.getByRole('button', { name: 'blog' }))
    expect(onPick).toHaveBeenCalledWith('p2')
  })
})
