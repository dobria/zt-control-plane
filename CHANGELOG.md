# Changelog

All notable changes to ZT Control Plane are documented in this file. Versions
follow [Semantic Versioning](https://semver.org/), and the format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/dobria/zt-control-plane/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dobria/zt-control-plane/releases/tag/v0.1.0
