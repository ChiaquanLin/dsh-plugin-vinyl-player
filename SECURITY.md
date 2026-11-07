# Security policy

## Scope

This plugin runs a small HTTP service inside the DeepSeek Harness host process and
renders a panel in the Web GUI. The parts that matter for security are:

- **The media token.** `/api/play` issues an opaque token that `/media?t=…`
  accepts. Tokens expire after 50 minutes and are not guessable, so a copied URL
  stops working. Please report any way to make the proxy serve an arbitrary URL, or
  to keep a token alive past its expiry.
- **The cover proxy.** `/api/cover?u=…` fetches an image from a third-party host.
  It is deliberately restricted to `*.hdslb.com` and `*.biliimg.com` over HTTPS, so
  it cannot be used as an open proxy. A bypass of that allow-list is a security
  bug — please report it.
- **The returned content type.** A response that is not an image is rejected rather
  than cached, so an upstream error page cannot be served to the browser as image
  bytes.

Out of scope: Bilibili changing or breaking its own endpoints, and any account
action taken by Bilibili against a user of this plugin.

## Reporting

Open a private security advisory through GitHub's "Report a vulnerability" button
on the repository's Security tab. Please do not open a public issue for a
proxy-bypass or token-forgery report.

Include the request you sent, the response you got, and what you expected. A
reproduction using only this repository and a local Harness profile is ideal.

## Supported versions

The latest release on `main` is supported. This is a small project maintained in
spare time, so older versions are not patched.
