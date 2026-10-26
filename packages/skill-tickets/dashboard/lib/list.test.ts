import { expect, test, vi } from 'vitest'
import type { ModuleHost } from '@openagt/dashboard/module'
import { listTickets, ticketsChanged } from './list.js'

const ticket = { file: 'a.md', title: 'a', summary: '', date: '2026-08-01T00:00:00.000Z', planned: false }

/** A host whose `list` answers when the test says. */
function slowHost(): { host: ModuleHost; answer: () => void } {
  const waiting: (() => void)[] = []
  const runCommand = vi.fn(() => new Promise(resolve => waiting.push(() => resolve({ ok: true, output: [ticket] }))))
  return { host: { runCommand } as unknown as ModuleHost, answer: () => waiting.splice(0).forEach(go => go()) }
}

test('the hot tickets card and the queue card naming its links, asking at once, read the tickets once; an answered list is never reused', async () => {
  const { host, answer } = slowHost()
  const both = Promise.all([listTickets(host, 'p1'), listTickets(host, 'p1')])
  expect(host.runCommand).toHaveBeenCalledTimes(1)
  answer()
  const [card, names] = await both
  expect(card).toEqual({ tickets: [ticket] })
  expect(names).toBe(card)
  const next = listTickets(host, 'p1')
  expect(host.runCommand).toHaveBeenCalledTimes(2)
  answer()
  await next
})

test('after a release, a list asked before it is no one\'s answer', async () => {
  const { host, answer } = slowHost()
  const before = listTickets(host, 'p2')
  ticketsChanged('p2')
  const after = listTickets(host, 'p2')
  expect(host.runCommand).toHaveBeenCalledTimes(2)
  answer()
  await Promise.all([before, after])
})
