Effort: 6
Uncertainty: 6

# [Plan] Reach a local machine from anywhere, without a VPS

How a computer behind a home or office router becomes reachable from a phone outside with no server: what exists already, which of the ticket's ways to build, in what order, and what a person decides first.

## Where things stand

`packages/dashboard-devices` already has three ways in (`src/door/serve.ts`):

- **On this Wi-Fi**: plain HTTP, home only.
- **On your Tailscale network** (`src/door/tailscale.ts`): the door listens on 127.0.0.1 and `tailscale serve` takes it to the person's devices over HTTPS. This is the ticket's way 4 ("tunnel service with the person's own account") and way 5 ("direct peer-to-peer, relay when needed"), through Tailscale's network. It needs the Tailscale app on the phone.
- **On a server** (`store.https`): the door speaks HTTPS on every network, with a Let's Encrypt certificate for the server's **IP address** that it asks for and renews itself (`acme.ts`, `certificate.ts`, port 80 for the proof). A computer at home reaches people through its line to a server (`line-out.ts`).

So without a VPS the one way left out is a phone with no Tailscale on a network outside. The rest of this plan covers that.

## What to build, in order

1. **Tailscale Funnel**, a small step: behind Tailscale, a second switch, "Also devices not on Tailscale", runs `tailscale funnel` in place of `tailscale serve` for the same door. Funnel answers at the same `*.ts.net` name on the public internet, with Tailscale's certificate. It works behind carrier-grade NAT and needs nothing on the phone. Like Serve, Funnel is turned on once in the person's Tailscale account (`fixAt` already handles this). The phone still gets in with a code, like at any door. This stands in for Cloudflare Tunnel and ngrok: the person already has the Tailscale account, and there is no second account or binary.
2. **Through your router** (ticket way 1, plus way 2 later): the computer asks its router to open a port, and the door then works like a server's door at the router's public address. It needs no account and costs nothing. When it fails, the door says why and points to Tailscale or a server.
3. Ways 5 (our own meeting point / WebRTC) and 6 (our relay) stay deferred, as in #1824. Funnel and Tailscale cover the same need for free.

## Problems

- **Can the router be asked at all?** UPnP IGD and NAT-PMP/PCP are often on, but some routers have them off and some ISP boxes refuse. We only find out by trying.
- **Carrier-grade NAT**: the router's own WAN address is shared (100.64.0.0/10, or a private range), so a mapping on it reaches nothing. Many mobile/fiber ISPs do this.
- **The proof for the certificate** needs public port 80 (HTTP-01) or 443 (TLS-ALPN-01). `acme.ts` does HTTP-01, so public 80 is mapped as well as 443. A router that already uses 80/443 for itself on the WAN side refuses the mapping.
- **The public address changes**: home addresses are usually stable for weeks but not always. A device saved the old address and cannot reach the computer to learn the new one, because its page is served by the computer itself.
- **Hairpin NAT**: a request coming in through the router can reach the door with a LAN source address. The Wi-Fi door takes asks with no code from its own network, so the internet door must never be the Wi-Fi door.

## Solutions

- Router: try PCP / NAT-PMP first (UDP 5351 to the gateway; a few bytes, simple), then UPnP IGD (SSDP multicast on 239.255.255.250:1900, then a SOAP `AddPortMapping` / `GetExternalIPAddress` to the URL from the description XML). Write both by hand in `src/door/router.ts`, as `acme.ts` and `wifi.ts` do; the package has almost no dependencies. Alternative: `@achingbrain/nat-port-mapper` (libp2p's, maintained), at the price of a dependency.
- Gateway address for NAT-PMP: there is no Node API for it, so read it from `route -n get default` (macOS) or `ip route show default` (Linux), behind an injectable dep.
- CGNAT: an external address in 100.64/10 or a private range means "your internet provider shares one address between homes", and the door stops there with that sentence. If the router's address looks public but the address is still shared further up, Let's Encrypt's own check fails ("could not reach this computer from the internet"); that check is the reachability test, and no outside echo service is needed.
- Certificate: reuse the server path as it is. An IP certificate for the external address, with the proof served on the internal port that public 80 maps to (`openProof` takes a port already).
- Address change: every few minutes, ask the router for its external address. When it changes, get a new certificate and show "The address changed: devices outside scan the new code" on This computer, with the new code from a device on the Wi-Fi or Tailscale. A free dynamic name would fix this properly, but every free one needs an account (DuckDNS, dynv6), which loses the "no account" point. **A person picks** (see Considerations).
- Hairpin: the internet door is its own listener, beside the Wi-Fi's, the way the Tailscale door is (`wifiListening` / `wifiProblem`). It follows the HTTPS door's rules (a code, always) and takes no Wi-Fi asks, whatever the source address.

## Considerations

- **DECISIONS.md conflict to flag in the PR, not decide**: "Reaching a computer from its server" says the line to a server was "picked over opening the computer at home to the internet first, which needs a port on its router and fails where the internet provider shares one address". Way 1 is that rejected alternative, offered as an extra way for people with no server. The person decides, and records the bullet, before step 2 starts. Step 1 (Funnel) does not touch that decision.
- Funnel ports: Funnel serves only on public 443, 8443 or 10000. The door already uses 443 behind Serve, so the same Serve config just gets the funnel flag. Turning the switch off has to run `tailscale funnel ... off` and leave Serve on.
- The internet door on a laptop is as exposed as a server's. The server door's protections apply as they are: headersTimeout, maxConnections, codes that work once for ten minutes, a wait after five wrong codes. Say so on the switch's confirm, the way On this Wi-Fi warns about plain HTTP.
- Leases: NAT-PMP/PCP mappings get a lifetime (2 h) renewed at half-life. UPnP mappings ask for a lease of 3600 s, renewed the same way; some routers only take 0 (forever), so fall back to it. Remove the mappings when the switch goes off and when the door's process ends cleanly. A mapping left behind by a crash is replaced at the next start; this is safe because the mapping names this computer's internal address and port.
- Several OpenAgents behind one router: the second gets public 443 refused. Use another public port for the door, but port 80 still has to be free for the proof. The door says the router's ports are taken by another computer.
- IPv6 (way 2): later, the same switch tries a pinhole (PCP, or UPnP `WANIPv6FirewallControl`) on the computer's global IPv6 address when IPv4 fails. Let's Encrypt issues IPv6 IP certificates, and most mobile networks are IPv6. Out of scope for the first PR.
- Manual port forwarding (way 3): the CLI's `https <at>` is close already. A "Forwarded by hand at <address>" field can come later; the first PR does not need it.
- macOS lets an ordinary user listen below 1024; Linux does not. With router mapping the internal port can be any port (the one after the Wi-Fi's door, as for Tailscale), so this does not matter.

## Implementation

### PR 1: Funnel
- `tailscale.ts`: `serveDoor(..., { funnel })` runs `tailscale funnel --bg --https=443 <door>` (or `serve` as today), and `stopServing` turns funnel off.
- `store.ts`: `tailscale.funnel?: true`. `cli.ts`: `tailscale funnel on|off`. `serve.ts` asks again until Funnel serves, like Serve. `fixAt` points to the admin page that turns Funnel on when Tailscale answers so.
- Dashboard `ThisComputer.tsx` and `devices.ts`: under "On your Tailscale network", a switch "Also devices not on Tailscale", with words saying the address is public and a device still needs a code.
- Tests: `tailscale.test.ts` with the fake `TailscaleRun`; `serve.test.ts`; `DevicesSettings.test.tsx`.

### PR 2: Through your router (after the person's go on the DECISIONS conflict and the address-change pick)
- `src/door/router.ts`: `gateway()`, `natPmp` / `pcp` map / unmap / externalAddress, `upnp` discover / map / unmap / externalAddress, `openPorts({ internal, external: [443, 80] })` → `{ address, via, ports } | { problem }`. All transports are injectable.
- `store.ts`: `internet?: { address: string; via: 'pcp' | 'nat-pmp' | 'upnp'; port: number; proofPort: number }` beside `https` / `tailscale`, plus `internetListening` / `internetProblem`.
- `serve.ts`: when `internet` is on, open the mappings, then a third listener with the HTTPS door's rules, `keepCertificate` for the external address with the proof on the mapped internal port. Keep the mappings alive, watch the external address, and run the problem sentences listed above.
- `cli.ts`: `internet on|off`, and `status` says it; the code link (`codeLink`) uses the internet address when asked for "from anywhere".
- Dashboard: a Way "From anywhere, through your router", with a switch, a confirm, the problem, and links to Tailscale / Connect a server when it fails.
- Tests: a fake NAT-PMP UDP responder and a fake IGD (an SSDP answer plus a SOAP HTTP server on 127.0.0.1) in `router.test.ts`. `serve-internet.test.ts` reuses the fake ACME office from `serve-https.test.ts`. A network test (`OPENAGENT_NETWORK_TESTS=1`) against the real router is optional and manual.
- Real-world check before merge: one home router with UPnP, one with it off, one CGNAT mobile hotspot.
