// Where the token is set. It lives in extension storage rather than in the page, so nothing on
// claude.ai can read the secret that talks to the daemon.

const DEFAULT_DAEMON = 'http://localhost:4200'
// The dashboard addresses the manifest's host permissions name, on any port and in any case: Chrome lets the extension reach no other.
const REACHABLE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
const daemonEl = document.getElementById('daemon')
const tokenEl = document.getElementById('token')
const statusEl = document.getElementById('status')
const autoOpenEl = document.getElementById('autoOpen')
const lastCycleEl = document.getElementById('lastCycle')

void chrome.storage.local.get(['daemonUrl', 'token', 'autoOpen']).then(({ daemonUrl, token, autoOpen }) => {
  daemonEl.value = daemonUrl || DEFAULT_DAEMON
  tokenEl.value = token || ''
  // Default on once configured, but stored explicitly so the worker never has to guess.
  autoOpenEl.checked = autoOpen !== false
})

/**
 * What the worker's last cycle did, as it recorded it: this page is the one place to read why
 * the bridge is doing nothing — or that the worker just reloaded the extension because its files
 * changed on disk — without opening a service worker console. Kept live while the page is open:
 * the worker records every cycle, and each record re-renders the line.
 */
function showLastCycle(lastCycle) {
  if (!lastCycle) {
    lastCycleEl.textContent = 'No cycle has run yet.'
    return
  }
  const at = lastCycle.at ? ` at ${new Date(lastCycle.at).toLocaleTimeString()}` : ''
  lastCycleEl.textContent = `Last cycle${at}: ${lastCycle.ok ? '' : 'failed — '}${lastCycle.reason ?? 'no reason recorded'}`
}
void chrome.storage.local.get('lastCycle').then(({ lastCycle }) => showLastCycle(lastCycle))
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastCycle) showLastCycle(changes.lastCycle.newValue)
})

function say(message, isError) {
  statusEl.textContent = message
  statusEl.className = isError ? 'error' : ''
}

/**
 * Are the host permissions actually granted?
 *
 * Declaring them in the manifest is not the same as holding them: Chrome lists each site under
 * "Site access" with its own toggle, and for an unpacked extension they can sit off. The daemon
 * sends no CORS headers by design, so without the localhost grant the worker's fetch is blocked
 * before it leaves the browser and the daemon sees nothing at all. That looked like every other
 * failure and cost an evening, so it is checked first now.
 */
async function missingHosts(daemonUrl) {
  const wanted = [`${daemonUrl}/`, 'https://claude.ai/']
  const missing = []
  for (const origin of wanted) {
    const ok = await chrome.permissions.contains({ origins: [`${origin}*`] }).catch(() => false)
    if (!ok) missing.push(origin)
  }
  return missing
}

document.getElementById('save').addEventListener('click', async () => {
  const daemonUrl = (daemonEl.value || DEFAULT_DAEMON).replace(/\/+$/, '')
  const token = tokenEl.value.trim()
  if (!token) return say('Paste the bridge token first.', true)
  await chrome.storage.local.set({ daemonUrl, token, autoOpen: autoOpenEl.checked })

  // Save then prove it: a token that is merely stored tells the user nothing, and the two ways
  // this goes wrong (bridge off, wrong token) are worth telling apart before they need it.
  say('Saved. Testing…')
  if (!REACHABLE.test(daemonUrl)) {
    return say(
      `The extension reaches the dashboard only at http://localhost or http://127.0.0.1 and its port, on an installed computer too: ${DEFAULT_DAEMON}, or the port OpenAgent was started with.`,
      true,
    )
  }
  const missing = await missingHosts(daemonUrl)
  if (missing.length) {
    return say(
      `Chrome has not granted access to ${missing.join(' and ')}. Open chrome://extensions, find this extension, and switch those on under Site access.`,
      true,
    )
  }
  try {
    const version = { 'x-oa-extension-version': chrome.runtime.getManifest().version }
    const res = await fetch(`${daemonUrl}/_bridge/ping`, { headers: { authorization: `Bearer ${token}`, ...version } })
    if (res.status === 401) return say('The dashboard is reachable but rejected the token.', true)
    if (res.status === 404) return say('Reached the dashboard, but the bridge is off. Turn it on in OpenAgent.', true)
    // The daemon refuses a version-skewed extension on every route (#1519); its answer names
    // both versions and the way out, so hand it over verbatim.
    if (res.status === 426) return say(await res.text(), true)
    if (!res.ok) return say(`The dashboard answered ${res.status}.`, true)
    // A 200 is not enough. The dashboard serves its single-page app for any path it does not
    // recognise, so a build with no bridge route answers 200 and a page of HTML, and treating
    // that as success would report "connected" to someone whose bridge does not exist.
    const body = (await res.text()).trim()
    if (body !== 'ok') return say('That dashboard has no bridge route. Update OpenAgent, then try again.', true)

    // Prove the read path too, not just auth. "Connected" on its own leaves the next question
    // unanswered: does the daemon actually have anything for us to watch?
    let watching = ''
    try {
      const list = await fetch(`${daemonUrl}/_bridge/sessions`, { headers: { authorization: `Bearer ${token}`, ...version } })
      const sessions = list.ok ? ((await list.json())?.sessions ?? []) : []
      watching = sessions.length
        ? ` Watching ${sessions.length} recent cloud session${sessions.length === 1 ? '' : 's'}${autoOpenEl.checked ? ', the Driver tab serves them.' : ' (the Driver tab is off).'}`
        : ' No recent cloud sessions to watch yet.'
    } catch {
      watching = ' Could not list sessions.'
    }
    say(`Connected. The bridge is on and the token works.${watching}`)
  } catch {
    say(`Could not reach ${daemonUrl}. Is the dashboard running?`, true)
  }
})


// Run a Driver cycle on demand. The alarm fires twice a minute, which is a long time to sit
// wondering whether anything is wrong, and every reason it might do nothing is reported. This
// also resumes a Driver the user paused by closing its tab.
document.getElementById('openNow').addEventListener('click', () => {
  say('Driving…')
  chrome.runtime.sendMessage({ type: 'oa-open-now' }, result => {
    if (chrome.runtime.lastError) return say(chrome.runtime.lastError.message ?? 'the worker did not answer', true)
    if (!result) return say('The worker did not answer. Try reloading the extension.', true)
    if (!result.ok) return say(`Did nothing: ${result.reason}`, true)
    say(`Driver cycle done: ${result.reason}.`)
  })
})
