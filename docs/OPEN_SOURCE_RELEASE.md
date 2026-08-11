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
- [ ] Keep `package.json`, `package-lock.json`, `CHANGELOG.md`, the release notes,
      and the `vMAJOR.MINOR.PATCH` tag on the same version.
- [ ] Tag immutable versions; do not publish only `latest`.
- [ ] Publish source from the same commit used for any binary image.
- [ ] Sign release artifacts and image provenance where the registry supports it.
- [ ] Publish only the standard `runtime` target to GHCR. Never publish the
      separately licensed `embedded-runtime` target from the release workflow.
- [ ] Confirm the release image is public, linked to this repository, and
      pullable without registry credentials.
- [ ] Re-test backup and restore before announcing the release.

## Versioned release flow

1. Prepare a pull request that updates the package version, changelog, release
   notes, and any version-pinned deployment examples.
2. Merge only after CI and review pass on the exact release diff.
3. Create a signed, annotated `vMAJOR.MINOR.PATCH` tag on the merged `main`
   commit and push only that tag.
4. Let `.github/workflows/release.yml` validate the version, test the source,
   scan the standard image, publish it to GHCR, attest it, and create the GitHub
   Release.
5. Verify the package digest and release notes before announcing the version.

The `demo-v1` tag exists only for the interface demo media and is not an
application release. Software versions use semantic `vMAJOR.MINOR.PATCH` tags.

When every box is checked, the release should be reproducible from the same
source commit and ready for someone new to try with confidence. The checklist
supports compliance work but does not replace legal advice.
