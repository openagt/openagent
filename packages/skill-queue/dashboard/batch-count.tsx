import { Stepper } from '@openagt/dashboard/module'

/** How many agents a project's batch starts, typed or stepped, from one to `max`: the Queue page's and the card's, joined to the press it counts for. */
export function BatchCount({ count, max, onChange, className }: { count: number; max: number; onChange: (count: number) => void; className?: string }) {
  return <Stepper value={count} max={max} label="How many agents to start" fewer="One agent fewer" more="One agent more" onChange={onChange} {...(className !== undefined ? { className } : {})} />
}
