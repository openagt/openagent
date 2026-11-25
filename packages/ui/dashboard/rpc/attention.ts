import type * as impl from '../../src/dashboard-rpc/attention.js'
import { rpc } from '../lib/rpc.js'

export const onAttention = rpc<typeof impl.onAttention>('onAttention')
