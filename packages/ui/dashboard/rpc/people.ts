import type * as impl from '../../src/dashboard-rpc/people.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/people.js'

// The people behind a project's commit emails at its git host: the pictures a card shows of its people.
export const onPeople = rpc<typeof impl.onPeople>('onPeople')
