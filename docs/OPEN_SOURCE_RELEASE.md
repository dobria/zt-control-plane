# Open-source release checklist

A calm, repeatable release is much nicer than a heroic last-minute one. Use this
checklist before the first public push and then reuse it for every release. Most
items are quick; together they keep the project safe, reproducible, and easy to
trust.

## Legal and branding

- [ ] Keep the public application under Apache-2.0 and preserve the separate
      GPL-2.0-only rule-compiler command and notices.
- [ ] Verify `THIRD_PARTY_NOTICES.md` and resolved dependency licenses.
- [ ] Keep the non-affiliation and trademark disclaimer visible in README.
- [ ] Do not add provider logos or claim official provider status.
- [ ] Do not publish an `embedded-runtime` image without separate legal review
      and all required upstream permissions.
- [ ] Review ZeroTier's current licenses again when updating its pinned version.

## Repository hygiene

- [ ] Scan the complete Git history for tokens, passwords, private identities,
      database files, private infrastructure names, and personal data.
- [ ] Create the public repository from a reviewed, clean history if the local
      development history contains environment-specific information.
- [ ] Confirm `.env`, SQLite files, backups, identities, and TLS keys are ignored.
- [ ] Configure GitHub private vulnerability reporting and branch protection.
- [ ] Replace placeholder project/contact links once the public URL is known.

## Build and security

- [ ] Run `npm ci` and `npm run check` from a clean checkout.
- [ ] Build the default `runtime` Docker target without the embedded overlay.
- [ ] Generate and retain an SBOM/provenance attestation for published images.
- [ ] Review dependency and container vulnerability results.
- [ ] Confirm the image contains `LICENSE`, dependency notices, and lockfile.
- [ ] Verify a fresh standard-mode setup with no automatically seeded controller.

## Release

- [ ] Document breaking changes and database compatibility.
- [ ] Tag immutable versions; do not publish only `latest`.
- [ ] Publish source from the same commit used for any binary image.
- [ ] Sign release artifacts and image provenance where the registry supports it.
- [ ] Re-test backup and restore before announcing the release.

When every box is checked, the release should be reproducible from the same
source commit and ready for someone new to try with confidence. The checklist
supports compliance work but does not replace legal advice.
