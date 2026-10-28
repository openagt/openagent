/**
 * The two pages the door itself answers with, to a device that is not in yet: the one a scanned
 * code opens, and the one that says how to get in. Plain HTML, nothing loaded from anywhere.
 */

const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 22rem; padding: 1.5rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { margin: 0; opacity: 0.8; }
`

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
<h1 id="title">${title}</h1>
<p id="text">${body}</p>
</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>
`
}

/** Which door a page is of: one on the Wi-Fi, a server's, or one behind Tailscale. */
export type DoorKind = 'wifi' | 'server' | 'tailscale'

/**
 * How to get in, in the words both pages use. A server has no screen of its own to press on:
 * the code comes from the computer the server was connected from, or from a device that is in.
 */
export function howToGetIn(kind: DoorKind): string {
  if (kind === 'server')
    return "This computer is a server. On the computer it was connected from, open OpenAgent's Settings › Devices › Add device › Phone or tablet, pick Anywhere, through this server, and scan the code with this device. A device that is already in can also make a code: its Settings › Devices › Add device."
  if (kind === 'tailscale')
    return 'This computer is on your Tailscale network. On it, open OpenAgent\'s Settings › Devices › Add device › Phone or tablet, and scan the code with this device; on a computer with no screen, run npx @openagt/devices add --qr. A device that is already in can also make a code: its Settings › Devices › Add device.'
  return 'On the computer that runs OpenAgent, open Settings › Devices › Add device › Phone or tablet, and scan the code with this device.'
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
    kind === 'server' ? 'Check that this device is on the internet, then scan the code again.' : kind === 'tailscale' ? 'Check that Tailscale is on on this device, signed in as on the computer, then scan the code again.' : 'Check that this device is on the same Wi-Fi as the computer, then scan the code again.'
  const script = `
    const say = (title, text) => { document.getElementById('title').textContent = title; document.getElementById('text').textContent = text }
    const code = location.hash.slice(1).split('.')[0]
    history.replaceState(null, '', location.pathname)
    fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(async answer => {
        if (!answer.ok) return say('This code no longer works', 'A code works once, for ten minutes. ' + ${JSON.stringify(howToGetIn(kind))})
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
