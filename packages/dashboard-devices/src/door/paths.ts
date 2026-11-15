/**
 * The door's own paths: the door answers them (door.ts), and another computer asks them of a
 * server's door (line-out.ts, pair.ts, servers/). None is ever passed on to OpenAgent.
 */

/** Every path of the door's own; never passed on. */
export const DOOR_PREFIX = '/_devices'
/** Where a scanned code lands, and where its page sends the code; where a computer's OpenAgent gets in, and takes itself out. */
export const ENTER_PATH = `${DOOR_PREFIX}/enter`
/** The computers that keep a line open here, for another computer's OpenAgent that is in. */
export const COMPUTERS_PATH = `${DOOR_PREFIX}/computers`
/** Where another computer's OpenAgent asks a computer on a line: `<VIA_PREFIX>/<its device id>/_relay/…`. */
export const VIA_PREFIX = `${DOOR_PREFIX}/via`
/** Who a device is here: its person, whether that is the owner, and that person's devices. */
export const ME_PATH = `${DOOR_PREFIX}/me`
/** Where a device takes one of its own person's devices out. */
export const ME_REMOVE_PATH = `${ME_PATH}/remove`
/** Where a computer that is in asks for a code its line gets in with, for its own person. */
export const ME_LINE_PATH = `${ME_PATH}/line`
/** Where a computer that is in asks for a code a device of its own person gets in with: a device that is in gives the code for the next one. */
export const ME_CODE_PATH = `${ME_PATH}/code`
/** Where a computer on this Wi-Fi asks to get in, hears the answer, and takes its ask away. */
export const ASK_PATH = `${DOOR_PREFIX}/ask`
/** Where a computer asks the door for a line. */
export const LINE_PATH = `${DOOR_PREFIX}/line`
