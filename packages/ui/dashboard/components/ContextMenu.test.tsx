import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { openMenu } from '../test-utils.js'
import { ContextMenu } from './ContextMenu.js'

afterEach(() => cleanup())

const button = () => screen.getByRole('button', { name: /^Context/ })

// The Context of a project's box (#661): the files picked for the message, removable.
describe("a project's Context", () => {
  test('the button says Context, then how many files are picked; its name says the same', () => {
    render(<ContextMenu files={[]} busy={false} onRemove={vi.fn()} />)
    expect(button().textContent).toBe('Context')
    expect(button().getAttribute('aria-label')).toBe('Context')
    cleanup()
    render(<ContextMenu files={['src/app.ts', 'README.md']} busy={false} onRemove={vi.fn()} />)
    expect(button().textContent).toBe('Context · 2 files')
    expect(button().getAttribute('aria-label')).toBe('Context: 2 files')
  })

  test('the picked files are listed, each removable; with none, how to add one', async () => {
    const onRemove = vi.fn()
    render(<ContextMenu files={['src/app.ts']} busy={false} onRemove={onRemove} />)
    await openMenu(button())
    expect(screen.getByText('Files')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /app\.ts/ }))
    expect(onRemove).toHaveBeenCalledWith('src/app.ts')
    cleanup()
    render(<ContextMenu files={[]} busy={false} onRemove={vi.fn()} />)
    await openMenu(button())
    expect(screen.getByText('None yet — add with # or the Files pane.')).toBeTruthy()
  })

  test('it is off while the box is busy', () => {
    render(<ContextMenu files={[]} busy onRemove={vi.fn()} />)
    expect((button() as HTMLButtonElement).disabled).toBe(true)
  })
})
