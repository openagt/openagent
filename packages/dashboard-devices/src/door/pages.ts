/**
 * The two pages the door itself answers with, to a device that is not in yet: the one a scanned
 * code opens, and the one that says how to get in. Plain HTML in OpenAgent's look, nothing loaded
 * from anywhere: the logo drawn in the page, the dashboard's palette written in, the system's font.
 */

/** The dashboard's palette (`tokens.css`), light and dark, under the dashboard's own names. */
const PALETTE = {
  light: { '--background': '#fafbf9', '--foreground': '#3a4248', '--muted': '#f3f5f2', '--muted-foreground': '#5f6e65', '--logo-1': '#0a0a0a', '--logo-2': '#171717', '--logo-3': '#262626', '--logo-4': '#404040', '--logo-5': '#525252', '--logo-6': '#737373' },
  dark: { '--background': '#171b1d', '--foreground': '#d3c6aa', '--muted': '#262d31', '--muted-foreground': '#9da9a0', '--logo-1': '#fafafa', '--logo-2': '#ededed', '--logo-3': '#d4d4d4', '--logo-4': '#a3a3a3', '--logo-5': '#8a8a8a', '--logo-6': '#737373' },
}

/** OpenAgent's mark, the dashboard's `Logo`: six strands, each a fill of the logo's ramp. */
const LOGO_STRANDS = [
  'M-160 -166.3 A10 10 0 0 0 -175 -174.9 L-234 -140.9 A10 10 0 0 0 -239 -132.2 L-239 34.1 A10 10 0 0 0 -234 42.7 L-72 136.3 A10 10 0 0 0 -62 136.3 L-21 112.6 A10 10 0 0 0 -21 95.3 L-173 7.5 A10 10 0 0 1 -178 -1.2 L-178 -97 A10 10 0 0 1 -173 -105.7 L-165 -110.3 A10 10 0 0 0 -160 -118.9 Z',
  'M64 -221.7 A10 10 0 0 0 64 -239 L5 -273.1 A10 10 0 0 0 -5 -273.1 L-149 -189.9 A10 10 0 0 0 -154 -181.3 L-154 5.8 A10 10 0 0 0 -149 14.4 L-108 38.1 A10 10 0 0 0 -93 29.4 L-93 -146.1 A10 10 0 0 1 -88 -154.7 L-5 -202.6 A10 10 0 0 1 5 -202.6 L13 -198 A10 10 0 0 0 23 -198 Z',
  'M224 -55.4 A10 10 0 0 0 239 -64.1 L239 -132.2 A10 10 0 0 0 234 -140.9 L90 -224 A10 10 0 0 0 80 -224 L-82 -130.5 A10 10 0 0 0 -87 -121.8 L-87 -74.5 A10 10 0 0 0 -72 -65.8 L80 -153.6 A10 10 0 0 1 90 -153.6 L173 -105.7 A10 10 0 0 1 178 -97 L178 -87.8 A10 10 0 0 0 183 -79.1 Z',
  'M160 166.3 A10 10 0 0 0 175 174.9 L234 140.9 A10 10 0 0 0 239 132.2 L239 -34.1 A10 10 0 0 0 234 -42.7 L72 -136.3 A10 10 0 0 0 62 -136.3 L21 -112.6 A10 10 0 0 0 21 -95.3 L173 -7.5 A10 10 0 0 1 178 1.2 L178 97 A10 10 0 0 1 173 105.7 L165 110.3 A10 10 0 0 0 160 118.9 Z',
  'M-64 221.7 A10 10 0 0 0 -64 239 L-5 273.1 A10 10 0 0 0 5 273.1 L149 189.9 A10 10 0 0 0 154 181.3 L154 -5.8 A10 10 0 0 0 149 -14.4 L108 -38.1 A10 10 0 0 0 93 -29.4 L93 146.1 A10 10 0 0 1 88 154.7 L5 202.6 A10 10 0 0 1 -5 202.6 L-13 198 A10 10 0 0 0 -23 198 Z',
  'M-224 55.4 A10 10 0 0 0 -239 64.1 L-239 132.2 A10 10 0 0 0 -234 140.9 L-90 224 A10 10 0 0 0 -80 224 L82 130.5 A10 10 0 0 0 87 121.8 L87 74.5 A10 10 0 0 0 72 65.8 L-80 153.6 A10 10 0 0 1 -90 153.6 L-173 105.7 A10 10 0 0 1 -178 97 L-178 87.8 A10 10 0 0 0 -183 79.1 Z',
]

const LOGO = `<svg viewBox="-289 -326 578 651.9" role="img" aria-label="OpenAgent">${LOGO_STRANDS.map((d, i) => `<path fill="var(--logo-${i + 1})" d="${d}"/>`).join('')}</svg>`

const vars = (palette: Record<string, string>): string => Object.entries(palette).map(([name, value]) => `${name}: ${value};`).join(' ')

const STYLE = `
  :root { color-scheme: light dark; ${vars(PALETTE.light)} }
  @media (prefers-color-scheme: dark) { :root { ${vars(PALETTE.dark)} } }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; box-sizing: border-box; padding: 24px 16px; display: grid; place-items: center; font: 16px/24px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: var(--background); color: var(--foreground); -webkit-text-size-adjust: 100%; }
  main { width: 100%; max-width: 22rem; text-align: center; }
  svg { display: block; width: 40px; height: 45px; margin: 0 auto 16px; }
  h1 { margin: 0 0 8px; font-size: 20px; line-height: 28px; font-weight: 600; overflow-wrap: anywhere; }
  p { margin: 0; color: var(--muted-foreground); white-space: pre-line; overflow-wrap: anywhere; }
  code { font: 14px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--foreground); background: var(--muted); border-radius: 6px; padding: 2px 6px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
`

/** `text` as HTML: what HTML would read as markup escaped, and a command between backticks drawn as code. */
function withCodes(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>')
}

function page(title: string, body: string, script = '', nonce = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenAgent</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${LOGO}
<h1 id="title">${withCodes(title)}</h1>
<p id="text">${withCodes(body)}</p>
</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>
`
}

/** Which door a page is of: one on the Wi-Fi, a server's, one behind Tailscale, or a server's behind Tailscale. */
export type DoorKind = 'wifi' | 'server' | 'tailscale' | 'tailscale-server'

/**
 * How to get in, in the words both pages use. A server has no screen of its own to press on:
 * the code comes from the computer the server was connected from, or from a device that is in.
 */
export function howToGetIn(kind: DoorKind): string {
  if (kind === 'server')
    return "This computer is a server. On the computer it was connected from, open OpenAgent's Settings › Devices › Add device › Phone or tablet, pick Anywhere, through this server, and scan the code with this device. A device that is already in can also make a code: its Settings › Devices › Add device."
  // A server's door is its owner's: a code made there for nobody would let the device in as them, so the command asks whose it is.
  if (kind === 'tailscale-server')
    return 'This computer is a server on your Tailscale network. Log in to it, run `openagent-devices add --for <your name> --qr`, and scan the code with this device. A device that is already in can also make a code: its Settings › Devices › Add device.'
  if (kind === 'tailscale')
    return 'This computer is on your Tailscale network. On it, open OpenAgent\'s Settings › Devices, press Add phone (or Add device › Phone or tablet), and scan the code with this device. On a computer with no screen, run\n\n`npx @openagt/dashboard-devices add --qr`\n\nA device that is already in can also make a code: its Settings › Devices › Add device.'
  return 'On the computer that runs OpenAgent, open Settings › Devices, press Add phone (or Add device › Phone or tablet), and scan the code with this device.'
}

/** What a device that is not in sees when it opens the door's address. */
export function notInPage(kind: DoorKind): string {
  return page('This device is not in', howToGetIn(kind))
}

/**
 * What a scanned code opens. The code rides the address after the `#`, which a browser keeps to
 * itself, so the page sends it in a request of its own: opening the address alone (a link
 * preview does that) spends nothing. What follows the code after a dot is for a computer that
 * pastes the link, not for a browser.
 */
export function enterPage(path: string, nonce: string, kind: DoorKind): string {
  const unreachable =
    kind === 'server' ? 'Check that this device is on the internet, then scan the code again.' : kind === 'tailscale' || kind === 'tailscale-server' ? 'Check that Tailscale is on on this device, signed in as on the computer, then scan the code again.' : 'Check that this device is on the same Wi-Fi as the computer, then scan the code again.'
  const script = `
    const say = (title, text) => { document.getElementById('title').textContent = title; document.getElementById('text').textContent = text }
    const code = location.hash.slice(1).split('.')[0]
    history.replaceState(null, '', location.pathname)
    fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(async answer => {
        if (!answer.ok) {
          say('This code no longer works', '')
          document.getElementById('text').innerHTML = ${JSON.stringify(withCodes(`A code works once, for ten minutes. ${howToGetIn(kind)}`))}
          return
        }
        // Whose device it is now, said a moment before OpenAgent opens.
        const person = (await answer.json().catch(() => ({}))).person
        if (typeof person !== 'string') return location.replace('/')
        say('You are in as @' + person, 'on ' + location.hostname + '. Opening OpenAgent…')
        setTimeout(() => location.replace('/'), 1500)
      })
      .catch(() => say('The computer did not answer', ${JSON.stringify(unreachable)}))
  `
  return page('Letting this device in…', 'One moment.', script, nonce)
}
