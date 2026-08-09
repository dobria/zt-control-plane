# Security Policy

ZT Control Plane sits close to important network infrastructure, so careful
security reports are especially appreciated. Thank you for giving maintainers
time to understand and fix a problem before it becomes public.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting instead of a public issue
or discussion. Include the affected version or commit, deployment model,
reproduction steps, expected impact, and any mitigation you have already found.

Do not include production credentials, ZeroTier identities, API tokens,
database files, backup archives, or unredacted diagnostics in a report.

## Supported versions

Until the project begins publishing tagged releases, security fixes target the
latest commit on the default branch. After releases begin, this policy will be
updated with an explicit support window.

## Deployment responsibility

The application manages network controllers and therefore holds privileged
credentials. Production operators must use HTTPS, a stable `APP_SECRET`, secure
cookies, a trusted reverse proxy configuration, restricted network exposure,
and regular backups of the complete persistent volume. See
[Deployment](docs/DEPLOYMENT.md) and [Operations](docs/OPERATIONS.md).
The documented trust boundaries and known residual risks are in the
[Security model](docs/SECURITY_MODEL.md).
