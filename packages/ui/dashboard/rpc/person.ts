import type * as impl from '../../src/dashboard-rpc/person.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/person.js'

// The person at this dashboard: the name and picture the foot of the sidebar shows.
export const onPerson = rpc<typeof impl.onPerson>('onPerson')
