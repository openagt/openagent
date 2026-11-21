// OpenAgent's mark (#757): the hexknot from https://brillout.github.io/brand-the-framework/.
//
// Six strands, each a flat fill in a neutral ramp. The fills are CSS variables rather than the
// literal hex values so the mark survives a dark background: the shipped ramp runs neutral-950 ->
// neutral-500, which on a dark canvas would sink the leading strands into it. `--logo-1..6` carry
// the brand values in light and a lightened ramp in dark (see `tailwind.css`).
//
// Not `currentColor` with per-strand opacity, which is the obvious way to make an SVG theme-aware:
// a knot's over/under crossings are literal overlaps, painted in order, so any strand below 100%
// opacity shows the one beneath it through the crossing.
//
// #875: while an agent is running, the same knot switches to the brand's animated variant — each
// strand a gradient cycling the six brand hues. Same paths, different fills, so the mark never
// moves; only its colour tells you the AI is at work.

/** The six brand hues the animated variant cycles through, in cycle order. */
const HUES = ['#e69875', '#dbbc7f', '#a7c080', '#7fbbb3', '#d699b6', '#e67e80']

/** One strand: its outline, and the gradient axis the animated variant paints it along. */
const STRANDS: { d: string; axis: [number, number, number, number] }[] = [
  {
    d: 'M-160 -166.3 A10 10 0 0 0 -175 -174.9 L-234 -140.9 A10 10 0 0 0 -239 -132.2 L-239 34.1 A10 10 0 0 0 -234 42.7 L-72 136.3 A10 10 0 0 0 -62 136.3 L-21 112.6 A10 10 0 0 0 -21 95.3 L-173 7.5 A10 10 0 0 1 -178 -1.2 L-178 -97 A10 10 0 0 1 -173 -105.7 L-165 -110.3 A10 10 0 0 0 -160 -118.9 Z',
    axis: [-160, -148.4, -36.5, 121.5],
  },
  {
    d: 'M64 -221.7 A10 10 0 0 0 64 -239 L5 -273.1 A10 10 0 0 0 -5 -273.1 L-149 -189.9 A10 10 0 0 0 -154 -181.3 L-154 5.8 A10 10 0 0 0 -149 14.4 L-108 38.1 A10 10 0 0 0 -93 29.4 L-93 -146.1 A10 10 0 0 1 -88 -154.7 L-5 -202.6 A10 10 0 0 1 5 -202.6 L13 -198 A10 10 0 0 0 23 -198 Z',
    axis: [48.5, -212.8, -123.5, 29.2],
  },
  {
    d: 'M224 -55.4 A10 10 0 0 0 239 -64.1 L239 -132.2 A10 10 0 0 0 234 -140.9 L90 -224 A10 10 0 0 0 80 -224 L-82 -130.5 A10 10 0 0 0 -87 -121.8 L-87 -74.5 A10 10 0 0 0 -72 -65.8 L80 -153.6 A10 10 0 0 1 90 -153.6 L173 -105.7 A10 10 0 0 1 178 -97 L178 -87.8 A10 10 0 0 0 183 -79.1 Z',
    axis: [208.5, -64.4, -87, -92.4],
  },
  {
    d: 'M160 166.3 A10 10 0 0 0 175 174.9 L234 140.9 A10 10 0 0 0 239 132.2 L239 -34.1 A10 10 0 0 0 234 -42.7 L72 -136.3 A10 10 0 0 0 62 -136.3 L21 -112.6 A10 10 0 0 0 21 -95.3 L173 -7.5 A10 10 0 0 1 178 1.2 L178 97 A10 10 0 0 1 173 105.7 L165 110.3 A10 10 0 0 0 160 118.9 Z',
    axis: [160, 148.4, 36.5, -121.5],
  },
  {
    d: 'M-64 221.7 A10 10 0 0 0 -64 239 L-5 273.1 A10 10 0 0 0 5 273.1 L149 189.9 A10 10 0 0 0 154 181.3 L154 -5.8 A10 10 0 0 0 149 -14.4 L108 -38.1 A10 10 0 0 0 93 -29.4 L93 146.1 A10 10 0 0 1 88 154.7 L5 202.6 A10 10 0 0 1 -5 202.6 L-13 198 A10 10 0 0 0 -23 198 Z',
    axis: [-48.5, 212.8, 123.5, -29.2],
  },
  {
    d: 'M-224 55.4 A10 10 0 0 0 -239 64.1 L-239 132.2 A10 10 0 0 0 -234 140.9 L-90 224 A10 10 0 0 0 -80 224 L82 130.5 A10 10 0 0 0 87 121.8 L87 74.5 A10 10 0 0 0 72 65.8 L-80 153.6 A10 10 0 0 1 -90 153.6 L-173 105.7 A10 10 0 0 1 -178 97 L-178 87.8 A10 10 0 0 0 -183 79.1 Z',
    axis: [-208.5, 64.4, 87, 92.4],
  },
]

/** The mark's label (#875), which is also what the tab's tooltip says. */
export function logoLabel(working: boolean): string {
  return working ? 'AI is working for you 🚀' : "AI isn't working for you 💤"
}

/** The label without the emoji (#948): a screen reader saying "rocket" helps nobody. */
export function logoSpokenLabel(working: boolean): string {
  return working ? 'AI is working for you' : "AI isn't working for you"
}

/** The hue `steps` along the cycle, wrapping. */
function hue(steps: number): string {
  return HUES[((steps % HUES.length) + HUES.length) % HUES.length]!
}

/** The hue cycle one stop walks, starting at `offset` and closing back on itself. */
function cycle(offset: number): string {
  return HUES.map((_, step) => hue(offset + step))
    .concat(hue(offset))
    .join(';')
}

export function Logo({ className, working = false }: { className?: string; working?: boolean }) {
  const label = logoLabel(working)
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-289 -326 578 651.9"
      className={className}
      role="img"
      aria-label={logoSpokenLabel(working)}
    >
      {/* Hovering the mark is the only place the label reads as prose. */}
      <title>{label}</title>
      {working && (
        <defs>
          {STRANDS.map(({ axis: [x1, y1, x2, y2] }, i) => (
            <linearGradient key={i} id={`hexknot-${i}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
              {/* The two stops sit one hue apart, so the cycle reads as a sweep along the strand. */}
              <stop offset="0" stopColor={hue(i)}>
                <animate attributeName="stop-color" dur="6s" repeatCount="indefinite" values={cycle(i)} />
              </stop>
              <stop offset="1" stopColor={hue(i - 1)}>
                <animate attributeName="stop-color" dur="6s" repeatCount="indefinite" values={cycle(i - 1)} />
              </stop>
            </linearGradient>
          ))}
        </defs>
      )}
      {STRANDS.map(({ d }, i) => (
        <path key={i} fill={working ? `url(#hexknot-${i})` : `var(--logo-${i + 1})`} d={d} />
      ))}
    </svg>
  )
}
