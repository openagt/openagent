import { useState } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { ImageOff, Loader2, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { BACKDROP_CLASS } from './ui/dialog.js'

// The images a message goes with, as tiles: in a row above the box's text, and in the chat with
// the message they went with. The whole image fits its tile, on a dark ground whatever the theme,
// so a light screenshot keeps its edge. A click shows it large, over the page.

/** One tile's image, and what is under way with it. */
export interface Tile {
  key: string
  src: string
  /** It is still being kept: a spinner over it. */
  going?: boolean | undefined
  /** It could not be kept, or is not on this computer: said on it. */
  error?: string | undefined
}

const TILE = 'relative size-[120px] shrink-0 overflow-hidden rounded-[10px] bg-neutral-900'

/** The tiles in a row, 8 apart; each with its X to take it out, when `onRemove` is given. */
export function ImageTiles({ tiles, onRemove, className }: { tiles: Tile[]; onRemove?: ((key: string) => void) | undefined; className?: string | undefined }) {
  const [shown, setShown] = useState<Tile | null>(null)
  if (tiles.length === 0) return null
  return (
    <>
      <ul aria-label="Images" className={cn('flex gap-2 overflow-x-auto [scrollbar-width:none]', className)}>
        {tiles.map((tile, at) => (
          <li key={tile.key} className={cn(TILE, 'group/tile')}>
            <TileImage tile={tile} at={at} onOpen={() => setShown(tile)} />
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove image ${at + 1}`}
                title="Remove"
                onClick={() => onRemove(tile.key)}
                // Shown while the pointer is on the tile or the keyboard on the X, and always to a finger.
                className="focus-ring absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/tile:opacity-100 hover:bg-black focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <X className="size-3" strokeWidth={2.5} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      <ImageViewer src={shown?.src} onClose={() => setShown(null)} />
    </>
  )
}

function TileImage({ tile, at, onOpen }: { tile: Tile; at: number; onOpen: () => void }) {
  const [broken, setBroken] = useState(false)
  const error = tile.error ?? (broken ? 'Not on this computer' : undefined)
  if (error !== undefined)
    return (
      <div role="img" aria-label={`Image ${at + 1}: ${error}`} title={error} className="flex size-full flex-col items-center justify-center gap-1.5 px-2 text-center text-xs leading-tight text-white opacity-70">
        <ImageOff className="size-4" aria-hidden />
        <span className="line-clamp-3">{error}</span>
      </div>
    )
  return (
    <button type="button" aria-label={`Open image ${at + 1}`} onClick={onOpen} className="focus-ring block size-full cursor-zoom-in rounded-[10px]">
      <img src={tile.src} alt="" onError={() => setBroken(true)} draggable={false} className={cn('size-full object-contain', tile.going && 'opacity-60')} />
      {tile.going && (
        <span className="absolute inset-0 flex items-center justify-center text-white" aria-label="Keeping the image" role="status">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </span>
      )}
    </button>
  )
}

/** An image large, over the page: its X, Esc or a click beside it closes it. */
export function ImageViewer({ src, onClose }: { src: string | undefined; onClose: () => void }) {
  return (
    <BaseDialog.Root open={src !== undefined} onOpenChange={open => !open && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={cn(BACKDROP_CLASS, 'bg-black/80')} />
        <BaseDialog.Popup
          data-overlay="dialog"
          aria-label="Image"
          className="fixed inset-0 z-50 flex items-center justify-center p-12 outline-none transition-opacity duration-180 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
          // A click beside the image, on the dim, closes it as a click on the backdrop would.
          onClick={event => event.target === event.currentTarget && onClose()}
        >
          {src !== undefined && <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />}
          <BaseDialog.Close aria-label="Close" title="Close (Esc)" className="focus-ring absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="size-5" aria-hidden />
          </BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
