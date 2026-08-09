# Security model

ZT Control Plane is a privileged administration surface. A compromised account
can change network membership, routes, DNS, flow rules and managed client
settings, so the safest deployment treats the application like a router or
hypervisor management console rather than an ordinary website.

This document explains what the application protects, where its trust
boundaries are, and which responsibilities remain with the operator. It is a
living model, not a claim that the software is invulnerable.

## What we protect

- controller and managed-node API credentials;
- user passwords, TOTP secrets, recovery codes and sessions;
- controller, network, member and audit metadata;
- the integrity of management operations sent to every connected provider;
- availability of the control plane and its SQLite state.

## Trust boundaries

### Browser to control plane

Every management route requires a session and role permission. Mutation routes
also require a same-origin browser request. Session and MFA challenge cookies
are HTTP-only, SameSite Strict, high-priority and secure when HTTPS is configured.
A nonce-based Content Security Policy, no-store responses and anti-framing
headers reduce browser-side attack surface.

The first administrator is protected by a high-entropy setup token. Supply it
through `APP_SETUP_TOKEN`, or read the randomly generated value once from the
application log. The generated copy is stored as `/data/app/setup.token` with
private file permissions.

### Reverse proxy to application

Forwarded client addresses are untrusted unless `TRUST_PROXY=1`. In that mode
`APP_PUBLIC_URL` is mandatory, and the proxy must replace client-supplied
forwarding headers. The optional IP access list depends on this boundary.

### Control plane to providers

Private, loopback and overlay addresses are supported because managing private
infrastructure is the application's purpose. Link-local metadata, unspecified,
multicast and reserved destinations are rejected both as URL literals and after
DNS resolution. Provider requests do not follow redirects, have connection and
body timeouts, and reject responses larger than 8 MiB. TLS verification is on by
default.

An administrator can intentionally register a private service, disable TLS
verification, or send valid destructive operations. Those are privileged
features, not sandboxed actions. Use dedicated least-privilege provider accounts
where the provider supports them.

### Application to persistent storage

Credentials and TOTP secrets are encrypted with AES-256-GCM under a persistent
application key. Passwords use salted scrypt hashes. Session and MFA challenge
tokens are random and only their SHA-256 hashes are stored in SQLite. On Unix,
the application data directory is mode `0700`, while the database, WAL, shared
memory, application key and setup token are mode `0600`.

Encryption at rest protects individual secret fields from casual database
disclosure; it does not protect a running application host that can read both
the database and `APP_SECRET`. Use encrypted host storage and tightly control
volume backups for that threat.

### Provider data to browser and backups

Provider response bodies are bounded before parsing. Diagnostics recursively
redact common credential and private-identity fields before returning data to
the browser. JSON backups use an explicit allowlist of portable network and
member configuration instead of copying raw provider objects. Backups still
contain sensitive network topology and should be protected accordingly.

## Abuse resistance

Sign-in failures are rate-limited in persistent SQLite buckets by account, by
trusted source IP when available, and by a global pre-authentication ceiling.
Unknown accounts still run the same scrypt verification path. MFA challenges
are short-lived, attempt-limited and protected against TOTP replay.

Request bodies, provider responses, flow-rule compilation, audit fields and
backup restore files all have explicit size or execution limits. The standard
container runs as an unprivileged user with a read-only root filesystem, no
Linux capabilities, `no-new-privileges`, and a bounded temporary filesystem.
The optional embedded profile necessarily has a larger host boundary because
ZeroTier One needs TUN and network capabilities.

## Important residual risks

- A compromised administrator session can perform the same high-impact actions
  as that administrator. Require 2FA for every privileged account and keep the
  web UI private.
- An operator can deliberately connect to an internal private endpoint. The
  SSRF policy blocks metadata and non-routable infrastructure classes, not the
  private networks the product is designed to manage.
- Disabling provider TLS verification permits interception on that path.
- A compromised container host or root user can read runtime secrets and alter
  the application.
- A malicious or compromised upstream provider can return false management
  state within the bounded and redacted response channel.
- The embedded image includes separately licensed upstream code and requires
  additional host privileges. Prefer the standard image when possible.
- SQLite supports one application replica. Sharing its volume between writers
  is unsupported and can harm availability or integrity.

## Recommended release gates

Before each release:

1. Run `npm ci`, `npm run check` and `npm audit`.
2. Build and smoke-test the standard image; test the embedded image separately
   when it changed.
3. Review dependency, base-image and GitHub Actions updates.
4. Confirm no credentials, databases, backups or unredacted diagnostics are in
   the repository or build context.
5. Run GitHub CodeQL with the `security-extended` query suite and enable secret
   scanning/private vulnerability reporting on the public repository.
6. Review every new outbound request, mutation route, role permission and data
   export as a security boundary.

See [Security Policy](../SECURITY.md) for private reporting and
[Deployment](DEPLOYMENT.md) for production configuration.
