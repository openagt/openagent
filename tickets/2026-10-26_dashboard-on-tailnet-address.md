Topics: dashboard, remote-access
Issue: [#2217](https://github.com/openagt/openagent/issues/2217)

# Dashboard on a tailnet address (Tailscale Serve / Funnel)

## TLDR

A dashboard behind a TLS-terminating reverse proxy on a non-loopback hostname doesn't work. Behind Tailscale Serve (`tailscale serve --bg 4200`, at `https://<host>.<tailnet>.ts.net`) the page loads, but every `/_rpc` call gets `403 unexpected Host header`. The cause is `isExpectedHost()` in `dashboard/rpc-serve.js`: it accepts only loopback hosts, and no setting changes that. The UI then shows "The daemon is not answering". Tailscale Funnel hits the same Host check. Its door also can't get its own Let's Encrypt certificate, because Funnel exposes only 443/8443/10000 and not port 80.

Decided (maintainer, in the issue): do it the way T3 Code does, with one-time pairing links.

- OA keeps listening on `127.0.0.1` only and sets up `tailscale serve` itself.
- Pairing is a one-time, short-lived link (and QR code) to the tailnet URL. Opening it on a new device redeems the token once and leaves that device paired; the link is useless afterwards. Paired requests are accepted alongside the loopback Host check, not instead of it.
- Today the link comes from Settings › Devices › Add device; add a command (e.g. `openagent pair`) for headless machines, which have no dashboard to open it from.

Not doing: a setting listing extra allowed hosts. The dashboard trusts whoever reaches it, so on the tailnet anyone the machine is shared with would be the owner in OA.

Later, perhaps: Tailscale Serve's `Tailscale-User-Login` headers could serve as identity.

## Why it matters

Today the only ways to reach a headless machine's dashboard are an external relay on a third-party IP or an SSH tunnel. That holds even when every device is already on the same tailnet with valid HTTPS.
