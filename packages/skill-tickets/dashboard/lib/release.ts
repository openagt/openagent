import type { ModuleHost } from '@openagt/dashboard/module'
import { ticketsChanged } from './list.js'

/**
 * Lift a ticket's claim, whoever holds it (`tickets release <file> --force`): a person's answer to
 * a claim no agent works on any more. Nothing times a claim out, so a stopped run's stands until
 * someone lifts it. An act, so the dashboard reads the lifted claim back at once, and no list asked
 * before it is the next read's answer.
 */
export async function releaseClaim(host: ModuleHost, projectId: string, file: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await host.act(projectId, ['release', file, '--force'])
  ticketsChanged(projectId)
  if (!result.ok) return result
  const answer = result.output as { ok?: unknown; reason?: unknown } | null
  return answer && typeof answer === 'object' && answer.ok === false ? { ok: false, error: `the release was refused: ${String(answer.reason)}` } : { ok: true }
}
