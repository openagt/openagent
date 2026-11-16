import { runSaid } from '@openagt/dashboard/module'
import { claimState, heldBack } from '../../src/module.js'
import type { WorkspaceTicket } from './types.js'

/** Where a ticket stands, as a list says it: the first that holds of claimed, in review, waiting, planned. */
export type TicketStageId = 'claimed' | 'in-review' | 'waiting' | 'planned' | 'unplanned'

export const STAGE_LABEL: Record<TicketStageId, string> = {
  claimed: 'Claimed',
  'in-review': 'In review',
  waiting: 'Waiting',
  planned: 'Planned',
  unplanned: 'Unplanned',
}

/** The order a list grouped by stage shows its parts in: what agents hold, then what is next for them, then what is held back. */
export const STAGE_ORDER: readonly TicketStageId[] = ['claimed', 'in-review', 'planned', 'unplanned', 'waiting']

export function ticketStage(ticket: Pick<WorkspaceTicket, 'locked' | 'pr' | 'waiting' | 'planned'>): TicketStageId {
  if (ticket.locked) return 'claimed'
  return heldBack(ticket) ?? (ticket.planned ? 'planned' : 'unplanned')
}

/** Whether the run holding a claim is at work right now: its mark pulses and the claim is said in colour. */
export function claimWorking(ticket: Pick<WorkspaceTicket, 'holderStatus'>): boolean {
  return ticket.holderStatus === 'running'
}

/** How the run holding a claim stands, said after its name: "working", "waits on your answer", "run done". */
export function claimStanding(holderStatus: string): string {
  return claimState(holderStatus) === 'stale' ? `run ${holderStatus}` : runSaid(holderStatus)
}
