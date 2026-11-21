import { useEffect, useRef, useState } from 'react'
import { sendImage } from '../rpc/control.js'
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, IMAGE_TYPES, IMAGES_PER_MESSAGE, imageAddress, type ImageType } from '../../src/images.js'
import { keepDraftImages, keptDraftImages } from './draft-handoff.js'

// The images a message goes with: read from what was dropped or pasted into the box, kept on this
// computer by the dashboard as soon as they are in the box, and named in the message by the name
// it kept each under. The box shows each from the file itself while it goes, so a tile is there at once.

/** An image in the box. */
export interface BoxImage {
  /** The box's own name for it, unique while it is in the box. */
  key: string
  /** What its tile shows: the file read in this browser, else the dashboard's copy. */
  src: string
  /** The name the dashboard kept it under; absent while it goes, or when it could not be kept. */
  name?: string | undefined
  /** Why it could not be kept: it stays in the box, said, until it is taken out. */
  error?: string | undefined
}

/** Whether `file` is an image the box takes. */
export function isBoxImage(file: File): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(file.type)
}

/**
 * The image files among what was dropped or pasted. A paste that carries words too (a copied page
 * or document, with a picture of itself beside them) is the words': only a paste of images alone is taken.
 */
export function imageFiles(data: DataTransfer | null, { pasted = false }: { pasted?: boolean } = {}): File[] {
  if (!data) return []
  if (pasted && data.types.includes('text/plain')) return []
  return Array.from(data.files).filter(file => file.type.startsWith('image/'))
}

let made = 0
const freshKey = (): string => `image-${(made += 1)}`

/** An image the box holds again, kept already: shown from the dashboard's copy. */
export function keptImage(name: string): BoxImage {
  return { key: freshKey(), src: imageAddress(name), name }
}

/** The names a box's images were kept under, in their order. */
export function imageNames(images: readonly BoxImage[]): string[] {
  return images.flatMap(image => (image.name !== undefined ? [image.name] : []))
}

/** What the box's images hold a send for, in words; none when they hold none. */
export function imagesHold(images: readonly BoxImage[]): string | undefined {
  if (images.some(image => image.error !== undefined)) return 'Remove the image that could not be kept'
  if (images.some(image => image.name === undefined)) return 'The images are still being kept'
  return undefined
}

/**
 * The images of the box `draftKey` names: those it was left with, kept with its draft across a
 * reload; what drops or pastes add, each kept on this computer at once; and what takes them out.
 * `keep` is how a file is kept, the dashboard's own unless a test says otherwise.
 */
export function useBoxImages(draftKey: string | undefined, keep: (file: File) => Promise<{ name: string } | { error: string }> = keepBoxImage) {
  const [images, setImages] = useState<BoxImage[]>(() => (draftKey !== undefined ? keptDraftImages(draftKey).map(keptImage) : []))
  const latest = useRef(images)
  latest.current = images
  // The kept ones go with the draft, so a reload brings them back.
  const names = imageNames(images).join('\n')
  useEffect(() => {
    if (draftKey !== undefined) keepDraftImages(draftKey, names === '' ? [] : names.split('\n'))
  }, [draftKey, names])
  // A file read in this browser is let go once its tile is.
  useEffect(() => () => latest.current.forEach(release), [])
  const update = (key: string, change: Partial<BoxImage>) => setImages(current => current.map(image => (image.key === key ? { ...image, ...change } : image)))
  return {
    images,
    /** Add `files`, as many as one message goes with; answers how many were left out. */
    add(files: File[]): number {
      const room = Math.max(0, IMAGES_PER_MESSAGE - latest.current.length)
      const taken = files.slice(0, room).map(file => ({ file, image: { key: freshKey(), src: URL.createObjectURL(file) } satisfies BoxImage }))
      setImages(current => [...current, ...taken.map(one => one.image)])
      for (const { file, image } of taken) void keep(file).then(kept => update(image.key, 'name' in kept ? { name: kept.name } : { error: kept.error }))
      return files.length - taken.length
    },
    remove(key: string): void {
      const image = latest.current.find(one => one.key === key)
      if (image) release(image)
      setImages(current => current.filter(one => one.key !== key))
    },
    /** Empty the box's images; answers the names of those it held, for {@link restore}. */
    clear(): string[] {
      const was = imageNames(latest.current)
      latest.current.forEach(release)
      setImages([])
      // At once, not once the box draws again: a box emptied by a start is gone before it does.
      if (draftKey !== undefined) keepDraftImages(draftKey, [])
      return was
    },
    /** Put back images {@link clear} took, before those added since. */
    restore(names: readonly string[]): void {
      setImages(current => [...names.map(keptImage), ...current])
    },
  }
}

/** Let go of the file a tile shows, when it was read in this browser. */
function release(image: BoxImage): void {
  if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src)
}

/**
 * Keep `file` on this computer: answers the name it was kept under, or why it was not. An image the
 * coding agents cannot take as it is (too large, too many pixels) goes smaller first, as they would
 * have to have it; a kind they cannot read at all is refused.
 */
export async function keepBoxImage(file: File): Promise<{ name: string } | { error: string }> {
  if (!isBoxImage(file)) return { error: `${file.type.replace('image/', '').toUpperCase() || 'This file'} is not an image the agent reads: PNG, JPEG, GIF or WebP` }
  let fitted: { type: ImageType; data: string }
  try {
    fitted = await fit(file)
  } catch {
    return { error: 'The image could not be read' }
  }
  try {
    const kept = await sendImage(fitted.type, fitted.data)
    return kept.ok ? { name: kept.name } : { error: kept.error }
  } catch {
    return { error: 'The image could not be kept: is OpenAgent running?' }
  }
}

/** The file's bytes as base64, the way a call carries them. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

/**
 * The image as the coding agents can take it: as it is when it fits their bounds (its bytes, its
 * edges), else drawn smaller until it does, a PNG while that fits and a JPEG past it.
 */
async function fit(file: File): Promise<{ type: ImageType; data: string }> {
  const type = file.type as ImageType
  if (file.size <= IMAGE_MAX_BYTES) {
    const size = await pixels(file).catch(() => undefined)
    if (size === undefined || Math.max(size.width, size.height) <= IMAGE_MAX_EDGE) return { type, data: await base64(file) }
  }
  const bitmap = await createImageBitmap(file)
  let scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  for (;;) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const [as, quality] of [['image/png', undefined], ['image/jpeg', 0.9]] as const) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, as, quality))
      if (blob && blob.size <= IMAGE_MAX_BYTES) return { type: as, data: await base64(blob) }
    }
    scale *= 0.75
  }
}

/** How many pixels wide and high the image is. */
async function pixels(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}
