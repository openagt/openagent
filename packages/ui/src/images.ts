// The images a person's message goes with, as the dashboard and the browser both speak of them:
// browser-safe, no `node:*` (the files themselves are agent-driver's, `@openagt/agent-driver`'s
// image store).

/** The kinds of image the coding agents read. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type ImageType = (typeof IMAGE_TYPES)[number]

/** The most bytes an image is sent at: what the agents' models take whole (5 MB as base64). */
export const IMAGE_MAX_BYTES = 3.75 * 1024 * 1024

/** The longest edge an image is sent at, in pixels: past it the models refuse it. */
export const IMAGE_MAX_EDGE = 8000

/** The most images one message goes with. */
export const IMAGES_PER_MESSAGE = 20

/** Where the dashboard serves the image kept under `name`. */
export function imageAddress(name: string): string {
  return `/_rpc/images/${encodeURIComponent(name)}`
}
