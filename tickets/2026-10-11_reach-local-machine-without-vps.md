Topics: remote-access, networking
Issue: [#2061](https://github.com/openagt/openagent/issues/2061)

# Reach a local machine from anywhere, without a VPS

## TLDR

A phone outside cannot reach a computer at home or in the office: it sits behind a router with no address of its own. The answer so far (#1824, step 5) is a small VPS the machine calls out to. Find ways that need no VPS, none tested yet:

1. **The router opens the port by itself** (UPnP, NAT-PMP), with a free name service following the home's changing address. No setup, no account. Fails where the provider shares one address between customers, or the router has it switched off.
2. **IPv6**: the machine often already has a public address. Fails on lines and phone networks without IPv6; the router must let the port in.
3. **A static IP with port forwarding set by hand**: like a VPS, often extra cost.
4. **A tunnel service with the user's own account** (Cloudflare Tunnel, ngrok): a fixed address from almost any line, but an account and a company in the middle.
5. **Direct phone-to-machine, like a video call**: a small meeting point introduces them. The most work; some networks need a relay anyway.
6. **A relay of ours for everybody**: deferred in #1824, it costs money.

Suggested: way 1 first, and when it fails OpenAgent says so and points to the VPS way; way 4 as the fallback for people who accept an account; way 5 is a project of its own.

## Why it matters

Reaching one's agents from a phone should not require renting and setting up a server.

## Notes

- Source: https://github.com/openagt/openagent/discussions/1824#discussioncomment-18869464
