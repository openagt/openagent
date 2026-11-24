// The images a person's messages go with, as the message box and this computer's store both speak
// of them: browser-safe, no `node:*` (the files themselves are `images.ts`'). What the box offers
// (`composer.images`), the store keeps and the host takes are these bounds.

/** The kinds of image the coding agents read, by media type. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** Those kinds in words. */
export const IMAGE_KINDS = 'PNG, JPEG, GIF or WebP'

/** The most bytes an image is kept at: what the agents' models take whole (5 MB as base64). */
export const IMAGE_MAX_BYTES = 3.75 * 1024 * 1024

/** The longest edge an image is kept at, in pixels: past it the models refuse it. */
export const IMAGE_MAX_EDGE = 8000

/** The most images one message goes with. */
export const IMAGES_PER_MESSAGE = 20

/** Where the app serves the images kept on this computer (`app.route`): `/_images/<name>`. */
export const IMAGES_ROUTE = '/_images'

/** Where the page loads the image kept under `name`. */
export function imageAddress(name: string): string {
  return `${IMAGES_ROUTE}/${encodeURIComponent(name)}`
}
