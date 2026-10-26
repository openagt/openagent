Topics: dashboard, remote-access
Issue: [#2217](https://github.com/openagt/openagent/issues/2217)

# Dashboard on a tailnet address (Tailscale Serve / Funnel)

## TLDR

A dashboard behind a TLS-terminating reverse proxy on a non-loopback hostname doesn't work. Behind Tailscale Serve (`tailscale serve --bg 4200`, at `https://<host>.<tailnet>.ts.net`) the page loads, but every `/_rpc` call gets `403 unexpected Host header`. The cause is `isExpectedHost()` in `dashboard/rpc-serve.js`: it accepts only loopback hosts, and no setting changes that. The UI then shows "The daemon is not answering". Tailscale Funnel hits the same Host check. Its door also can't get its own Let's Encrypt certificate, because Funnel exposes only 443/8443/10000 and not port 80.

Asked for:

1. A setting listing extra allowed hosts (e.g. `allowedHosts: ["<host>.<tailnet>.ts.net"]`), with the same-origin check applied to them, so the DNS-rebinding protection stays.
2. A door mode that has no certificate of its own ("TLS is terminated upstream"), so Funnel or any HTTPS proxy can sit in front of it.

Later, perhaps: Tailscale Serve's `Tailscale-User-Login` headers could serve as identity.

## Why it matters

Today the only ways to reach a headless machine's dashboard are an external relay on a third-party IP or an SSH tunnel. That holds even when every device is already on the same tailnet with valid HTTPS.
