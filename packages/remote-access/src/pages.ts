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

/** How to get in, in the words both pages use. */
export const HOW_TO_GET_IN = 'On the computer that runs OpenAgent, open Settings, find Devices, press Add device, and scan the code with this device.'

/** What a device that is not in sees when it opens the door's address. */
export function notInPage(): string {
  return page('This device is not in', HOW_TO_GET_IN)
}

/**
 * What a scanned code opens. The code rides the address after the `#`, which a browser keeps to
 * itself, so the page sends it in a request of its own: opening the address alone (a link
 * preview does that) spends nothing.
 */
export function enterPage(path: string, nonce: string): string {
  const script = `
    const say = (title, text) => { document.getElementById('title').textContent = title; document.getElementById('text').textContent = text }
    const code = location.hash.slice(1)
    history.replaceState(null, '', location.pathname)
    fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(answer => {
        if (answer.ok) location.replace('/')
        else say('This code no longer works', 'A code works once, for five minutes. ' + ${JSON.stringify(HOW_TO_GET_IN)})
      })
      .catch(() => say('The computer did not answer', 'Check that this device is on the same Wi-Fi as the computer, then scan the code again.'))
  `
  return page('Letting this device in…', 'One moment.', script, nonce)
}
