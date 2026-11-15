import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Waiting } from './Waiting.js'

test('draws its shape as a slot that waits does, and says it is loading', () => {
  render(<Waiting shape={<i data-testid="shape" />} />)
  expect(screen.getByRole('status').textContent).toBe('Loading…')
  expect(screen.getByTestId('shape')).toBeTruthy()
})
