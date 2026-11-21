import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipsPastBox } from './tooltip.js'

afterEach(cleanup)

function Box({ past }: { past: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const item = (
    <Tooltip>
      <TooltipTrigger>Skills</TooltipTrigger>
      <TooltipContent>Every project skill</TooltipContent>
    </Tooltip>
  )
  return <div ref={box}>{past ? <TooltipsPastBox value={box}>{item}</TooltipsPastBox> : item}</div>
}

async function open() {
  act(() => void fireEvent.focus(screen.getByRole('button', { name: 'Skills' })))
  const tip = await screen.findByRole('tooltip')
  return tip.parentElement!
}

describe("a tooltip of an item in a box's row", () => {
  test("opens past the box's edge, under it, its left edge on the item's", async () => {
    render(<Box past />)
    const positioner = await open()
    expect([positioner.dataset['side'], positioner.dataset['align']]).toEqual(['bottom', 'start'])
  })

  test('anywhere else opens over its trigger, centred, as every tooltip does', async () => {
    render(<Box past={false} />)
    const positioner = await open()
    expect([positioner.dataset['side'], positioner.dataset['align']]).toEqual(['top', 'center'])
  })
})
