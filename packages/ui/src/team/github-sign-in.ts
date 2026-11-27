import type { TeamPerson } from './team-file.js'

// Sign in with GitHub, by its device flow: GitHub gives a code, the person enters it at
// github.com/login/device, and OpenAgent asks until GitHub says yes. It asks for no scope: the
// token only reads who the person is, once, and is let go. The app is OpenAgent's own, owned by
// the openagt organization; a device flow needs no secret, so its ID is all this side knows.

/** OpenAgent's OAuth app on GitHub (openagt). */
export const GITHUB_CLIENT_ID = 'Ov23lid5fZ0QKWEdVdQw'

/** What GitHub gives to show the person. */
export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** Seconds the code holds. */
  expiresIn: number
  /** Seconds to wait between two asks. */
  interval: number
}

/** What one ask says: still waiting, ask slower, the end of it, or the person. */
export type Poll = { state: 'pending' } | { state: 'slow-down'; interval: number } | { state: 'ended'; reason: string } | { state: 'done'; person: TeamPerson }

export interface GitHubSignIn {
  start(): Promise<DeviceCode>
  poll(deviceCode: string): Promise<Poll>
}

type Fetch = typeof fetch

/** The device flow against GitHub, through `fetchImpl` (a test's own). */
export function githubSignIn(fetchImpl: Fetch = fetch, clientId = GITHUB_CLIENT_ID): GitHubSignIn {
  const post = async (url: string, form: Record<string, string>): Promise<Record<string, unknown>> => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok && typeof body.error !== 'string') throw new Error(`GitHub answered ${res.status}`)
    return body
  }
  return {
    async start() {
      const body = await post('https://github.com/login/device/code', { client_id: clientId, scope: '' })
      if (typeof body.error === 'string') throw new Error(typeof body.error_description === 'string' ? body.error_description : body.error)
      const { device_code, user_code, verification_uri, expires_in, interval } = body
      if (typeof device_code !== 'string' || typeof user_code !== 'string' || typeof verification_uri !== 'string') throw new Error('GitHub gave no code')
      return {
        deviceCode: device_code,
        userCode: user_code,
        verificationUri: verification_uri,
        expiresIn: typeof expires_in === 'number' ? expires_in : 900,
        interval: typeof interval === 'number' ? interval : 5,
      }
    },
    async poll(deviceCode) {
      const body = await post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
      if (body.error === 'authorization_pending') return { state: 'pending' }
      if (body.error === 'slow_down') return { state: 'slow-down', interval: typeof body.interval === 'number' ? body.interval : 10 }
      if (body.error === 'expired_token') return { state: 'ended', reason: 'The code ran out. Start again.' }
      if (body.error === 'access_denied') return { state: 'ended', reason: 'GitHub was told no.' }
      if (typeof body.error === 'string') return { state: 'ended', reason: typeof body.error_description === 'string' ? body.error_description : body.error }
      if (typeof body.access_token !== 'string') return { state: 'ended', reason: 'GitHub gave no token.' }
      return { state: 'done', person: await whoIs(fetchImpl, body.access_token) }
    },
  }
}

/** Who a token is GitHub's account of. */
async function whoIs(fetchImpl: Fetch, token: string): Promise<TeamPerson> {
  const res = await fetchImpl('https://api.github.com/user', {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'OpenAgent' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GitHub did not say who you are (${res.status})`)
  const user = (await res.json()) as Record<string, unknown>
  if (typeof user.login !== 'string' || typeof user.id !== 'number') throw new Error('GitHub did not say who you are')
  return {
    login: user.login,
    id: user.id,
    ...(typeof user.name === 'string' && user.name ? { name: user.name } : {}),
    ...(typeof user.avatar_url === 'string' ? { avatar: user.avatar_url } : {}),
  }
}
