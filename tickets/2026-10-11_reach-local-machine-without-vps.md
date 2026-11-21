Topics: devices, networking
Issue: [#2061](https://github.com/openagt/openagent/issues/2061)

# Reach a local machine from anywhere, without a VPS

## TLDR

A machine behind a home/office router can't be reached from a phone outside; #1824's answer is a small VPS. Ways without a VPS (none tested yet):

1. Router opens the port itself (UPnP / NAT-PMP) plus a free dynamic name service. Fails behind carrier-grade NAT or when disabled.
2. IPv6 public address. Fails without IPv6; router must let the port in.
3. Static IP with manual port forwarding.
4. Tunnel service with the user's own account (Cloudflare Tunnel, ngrok).
5. Direct peer-to-peer like a video call (meeting point, relay sometimes needed). Most work.
6. A relay of ours for everybody — deferred in #1824 (costs money).

Suggestion: way 1 first (automatic, free); when it fails, say so and point to the VPS way. Way 4 as a fallback for people who accept an account. Way 5 is a project of its own.

Source: https://github.com/openagt/openagent/discussions/1824#discussioncomment-18869464

## Why it matters

Using OpenAgent from a phone shouldn't require renting and setting up a server.
