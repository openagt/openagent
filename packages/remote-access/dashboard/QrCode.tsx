import { encode } from 'uqr'

/**
 * A link as a QR code. Always dark on white, whatever the page's theme: a phone's camera reads
 * the contrast, not the colours of the page around it.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 })
  let path = ''
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`
    })
  })
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="h-56 w-56 max-w-full rounded-md bg-white">
      <path d={path} fill="black" />
    </svg>
  )
}
