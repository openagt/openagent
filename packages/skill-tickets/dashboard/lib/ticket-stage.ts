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

/** Whether the run holding a claim is at it, so its mark turns; a claim whose run ended, or another machine's, rests. */
export function claimWorking(ticket: Pick<WorkspaceTicket, 'holderStatus'>): boolean {
  return claimState(ticket.holderStatus) === 'working'
}
