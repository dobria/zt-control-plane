# Changelog

All notable changes to ZT Control Plane are documented in this file. Versions
follow [Semantic Versioning](https://semver.org/), and the format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.2] - 2026-08-11

### Fixed

- Made RouterOS Joined network creation compatible across RouterOS versions by
  omitting optional interface values that match RouterOS defaults.
- Updated RouterOS client interfaces with only the values that actually
  changed, avoiding rejected writes of unchanged runtime configuration.
- Kept RouterOS validation and provider errors visible inside the Joined
  network dialog so corrective action can be taken without closing it.

## [0.1.1] - 2026-08-11

### Security

- Removed the bundled npm and package-manager toolchain from the final runtime
  image. These build-only files were unused by the running application and
  included `tar` 7.5.11, affected by CVE-2026-59873.
- Kept dependency installation and compilation in isolated build stages while
  reducing the published image's runtime attack surface.

### Release note

- `v0.1.1` is the first container release. The protected `v0.1.0` source tag
  remains as an audit record; its publication was stopped by the critical
  vulnerability gate before any image or GitHub Release was created.

## [0.1.0] - 2026-08-11

### Added

- Multi-controller registry for remote ZeroTier One, MikroTik RouterOS, New
  Central, and Legacy Central providers.
- Global network and node inventories that preserve controller ownership.
- Network, member, route, address-pool, DNS, Flow Rule, tag, and capability
  operations where supported by the selected provider.
- Managed ZeroTier One and RouterOS nodes, including multiple RouterOS
  instances, joined networks, hosted controller networks, members, and peers.
- Role-based users, TOTP two-factor authentication, recovery codes, IP access
  rules, audit history, diagnostics, encrypted provider credentials, and
  backup/restore.
- Failure-isolated provider discovery with bounded timeouts, short caches, and
  stale read-only inventory during provider outages.
- Unprivileged standard Docker deployment and a separately documented optional
  embedded-controller build.
- Automated CI, dependency review, CodeQL, Dependabot, security policy, and
  private vulnerability reporting guidance.

### Security

- State-changing requests enforce same-origin validation.
- Provider URLs are checked against SSRF-sensitive address ranges and bounded
  response handling.
- Published standard images are built from the tagged source, scanned for fixed
  critical vulnerabilities, and include SBOM and provenance attestations.

### Known limitations

- The first published container image supports `linux/amd64` only.
- SQLite supports one application replica and one writer.
- Provider capabilities differ; unsupported controls are intentionally hidden.
- The embedded ZeroTier One image is not distributed through GHCR and remains
  subject to separate upstream licensing terms.

[Unreleased]: https://github.com/dobria/zt-control-plane/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/dobria/zt-control-plane/releases/tag/v0.1.2
[0.1.1]: https://github.com/dobria/zt-control-plane/releases/tag/v0.1.1
[0.1.0]: https://github.com/dobria/zt-control-plane/tree/v0.1.0
