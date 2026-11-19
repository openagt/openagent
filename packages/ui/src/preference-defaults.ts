/**
 * The bounds the controls that write a setting share. A leaf module (no `node:*`), so `client.ts`
 * can export it and the dashboard and its plugins read the same values.
 */

/**
 * How far either side of the quota boundary the usage bar's handle reaches, in percentage points
 * (#960): the bound of the stop line a module puts on the bar, which the bar clamps a drag to.
 */
export const MAX_SPEND_OFFSET = 50
