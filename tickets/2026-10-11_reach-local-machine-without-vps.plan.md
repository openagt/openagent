Effort: 6
Uncertainty: 7

# [Plan] Reach a local machine from anywhere, without a VPS

This file holds the plan for reaching a computer at home or in the office from a phone outside, with no VPS in between.

## What is there already

- `remote-access https <at>` (packages/remote-access/src/cli.ts, serve.ts) already turns any computer into a "server": the door listens on 443 for every network, asks Let's Encrypt for a certificate for `<at>` (a number *or* a name, `acme.ts` picks `ip` or `dns`), proves it over plain HTTP on port 80 (`http-01`, the only challenge it answers), and renews it.
- So **way 3 (a static IP with ports 80 and 443 forwarded by hand) works today**, and so does way 3 with a dynamic-DNS name the person set up themselves: `remote-access https my-home.duckdns.org`. Nothing tells the person so; the dashboard offers only "Your own server (a VPS)".
- Way 1 is way 3 with the router opened by OpenAgent and the address kept up to date by OpenAgent. Way 2 is way 3 with an IPv6 address. Way 4 is a different shape: the TLS ends at the tunnel company, not at the door.

## Problems

1. **A decision says no.** packages/remote-access/DECISIONS.md, "Reaching a computer from its server": the line was "picked over opening the computer itself to the internet". Ways 1-4 open the computer itself to the internet (the door, with the same per-device keys a server's door has). The ticket asks for exactly that, so the person who wrote it seems to accept it, but the decision must be changed by a person before this ships (a bullet saying a home computer may open its door to the internet when the person asks, on a switch that is off by default, like Phone on Wi-Fi).
2. **The address changes, and the address is the origin.** A device is in through a cookie on the door's origin (`https://<at>`), and a computer that keeps a line or added the machine by its link knows it by that address. A home line's public number changes (daily on some providers, after a router restart on most). With a bare number every change means every phone scans again. Way 1 is only useful with a **name that follows the number**, and the ticket's "free name service, no account" has no clean answer:
   - DuckDNS / deSEC (dedyn.io): free, but an account and a token the person pastes. Small and reliable.
   - A name service of OpenAgent's own (`<id>.openagent.build`, updated by the computer with a key, like the ones the door already keeps): no account for the person, but a service to run and pay for, much cheaper than the relay of way 6, and a company (us) in the middle of the name, not of the traffic.
   - The bare number, re-certified on change, and the person told to scan again: no account, no service, poor.
   This is the pick a person has to make; the rest of way 1 does not depend on it.
3. **Port 80.** `http-01` needs port 80 from outside; many home providers block inbound 80 (and some 443). `tls-alpn-01` (Let's Encrypt allows it for numbers and names) proves on 443 alone. When 443 itself is blocked, only a name proved over DNS (`dns-01`, needs the name service to set a TXT record: easy with our own service or deSEC, possible with DuckDNS) gives a certificate, and the door then listens on another external port.
4. **Shared addresses (CGNAT).** The router opens the port, but the address it has is not the one the internet sees (100.64.0.0/10, or a private range), and nothing comes in. Must be found and said, not left as a certificate that never arrives.

## Solutions

### Way 1: the router opens the port (first, as the ticket suggests)

- **Opening the port**, in a new `src/router.ts`, no dependency (all small UDP/HTTP protocols):
  - PCP / NAT-PMP (RFC 6887 / 6886): UDP to the gateway on 5351. The gateway's number: macOS `route -n get default`, Linux `/proc/net/route`; Windows `route print` (or skip Windows at first).
  - UPnP IGD: SSDP M-SEARCH to 239.255.255.250:1900, read the device description, SOAP `AddPortMapping` / `GetExternalIPAddress` on `WANIPConnection` (or `WANPPPConnection`).
  - Try PCP/NAT-PMP first (simpler, has leases), then UPnP. Map external 443 (and 80 while `http-01` is used) to the door's port; ask for a lease (e.g. 2 h) and renew it at half-life from the door's process (serve.ts already runs the renewal loop of the certificate; the mapping lives beside it). Remove the mappings when the switch goes off.
- **Finding a shared address**: the external number the router reports is private or in 100.64.0.0/10 → say "Your provider shares one internet address between customers: nothing from outside reaches this computer. Use a VPS (Machines) instead." Otherwise the certificate's own proof is the test from outside: a proof that fails after the port opened says "The router opened the door, but nothing from outside reached it" and points to the VPS way.
- **Following the number**: poll the router's external number (cheap, local) every few minutes; on change, update the name (per Problem 2's pick). With a name nothing else changes: the certificate is for the name, devices and lines keep working.
- **Proof**: add `tls-alpn-01` to `acme.ts` (a self-signed certificate with the `acmeIdentifier` extension served on 443 for the ALPN `acme-tls/1`; `der.ts` already writes certificates' parts) and prefer it, so only 443 has to be opened. Keep `http-01` for servers as they are.
- **The switch**: `remote-access internet on|off` (name to pick; "Reach from anywhere" in the Devices section), off by default, saying first what it means: the door is open to the internet, a device still needs a scanned code. It reuses the `https` path of serve.ts with the address it found, so `store.https` gets a `router: true` (or similar) to know to keep the mapping and follow the number.

### Way 2: IPv6

- Same switch, an option, not a way of its own: when the computer has a global, *non-temporary* IPv6 address (`networkInterfaces()`, skip privacy/temporary ones; macOS marks them, Linux shows `temporary` only via `ip -6 addr`), the name gets an AAAA record beside the A record. A phone on IPv6 reaches it even behind a shared IPv4 address. The router's IPv6 firewall still has to let 443 in: PCP can ask for that (`MAP` with an IPv6 address); UPnP's `WANIPv6FirewallControl` is rarely there. Without a name (Problem 2) IPv6 is not worth doing: a bare IPv6 number in the code fails on every IPv4-only phone network, and the prefix changes too.

### Way 3: by hand

- No code in the door. In the dashboard, beside "Your own server (a VPS)": "This computer, with ports 443 and 80 forwarded on your router" → asks the address or name and runs `remote-access https <at>`. Comes for free once way 1's switch exists: way 1 is this with the forwarding done for the person, and when way 1 fails its message can name this.

### Way 4: a tunnel with the person's own account (the fallback)

- Cloudflare named tunnel (`cloudflared tunnel run --token <token>`, needs an account and a domain on Cloudflare) or ngrok (one free fixed domain per account, `ngrok http --domain=…`). Quick tunnels (`trycloudflare.com`) need no account but give a new random name each start: same problem as a changing number, not usable.
- The tunnel program is run by the door's process as a child, pointed at the door on 127.0.0.1; the person pastes the token once.
- Two things in the door change: the tunnel's requests arrive from 127.0.0.1, so `knocks` must let them in as from the internet (`knocks: () => true`, like a server) and nothing may treat a loopback peer as this computer; and the TLS ends at the tunnel, so a computer keeping a line to this one cannot pin the door's key (`NOT_THE_SERVER` in line-out.ts) and must trust the name's certificate instead.
- Separate ticket: it is independent of way 1 and asks a person whether OpenAgent should depend on cloudflared/ngrok being installed.

### Way 5 and way 6

- Out of this ticket. Way 5 (WebRTC) needs a page served from an HTTPS origin that is not the computer, a WebRTC stack in Node (node-datachannel or werift), a meeting point, and a relay (TURN) for the networks where it fails: a project of its own, as the ticket says; open a ticket for it. Way 6 stays deferred (#1824).

## Considerations

- Security: the door on the internet is what a VPS's door already is (per-device keys, codes valid five minutes once). The new risk is the home network: the router mapping only opens the door's port, never OpenAgent's own (127.0.0.1:4200). Say it in the switch's text.
- Routers with UPnP off, double NAT (a provider box in front of the person's router: the inner router's external number is private → found as Problem 4), and mappings the router forgets on restart (the lease renewal puts them back).
- macOS asks once whether node may accept incoming connections; the first time the switch is on, say so.
- Testing: router.ts against a fake gateway on localhost (UDP and an HTTP SOAP endpoint), like `test-office.ts` fakes the certificate office; `tls-alpn-01` against Pebble or the fake office.
- Phone on Wi-Fi and the internet switch both open the door; with the internet switch on, the Wi-Fi link should be the name too, so a device scanned at home keeps working outside (one origin, one cookie).

## Implementation

Ask the person first: Problem 1 (change the decision) and Problem 2 (where the name comes from). Then, each its own pull request:

1. `acme.ts`: `tls-alpn-01`, preferred when offered; servers keep working (tests in acme.test.ts / serve-https.test.ts).
2. `router.ts`: PCP/NAT-PMP and UPnP IGD, map / renew / remove / external number, with a fake gateway in tests.
3. The name: per the pick (a DuckDNS/deSEC token field, or a client for our own name service, plus the service itself if chosen).
4. The switch: CLI command, `store.https` remembers it is the router's, serve.ts keeps the mapping and follows the number, the messages for a shared address and an unreachable port; the Devices section gets the switch, the Machines section's "Your own server" text names it as the way without a VPS. DECISIONS.md bullet as the person words it.
5. IPv6 as an AAAA record on the name, when step 3 can set one.
6. New tickets: way 4 (a tunnel with the person's account), way 5 (direct phone-to-computer).
