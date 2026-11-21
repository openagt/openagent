import { readFileSync } from 'node:fs'
import { imageFile, imageMediaType } from '@openagt/agent-driver'

/** A block of a user message as Claude Code's stream-json input takes it: words, or an image. */
export type UserBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * A user message's content as Claude Code reads it: its words alone, or, with images, the images
 * first, as the model reads them best, then the words. An image this computer no longer keeps is
 * said in words in its place, so the message still goes.
 */
export function userContent(words: string, images: readonly string[] = []): string | UserBlock[] {
  if (images.length === 0) return words
  return [...images.map(imageBlock), { type: 'text', text: words }]
}

function imageBlock(name: string): UserBlock {
  try {
    return { type: 'image', source: { type: 'base64', media_type: imageMediaType(name), data: readFileSync(imageFile(name)).toString('base64') } }
  } catch {
    return { type: 'text', text: `(An image sent with this message is no longer on this computer.)` }
  }
}
