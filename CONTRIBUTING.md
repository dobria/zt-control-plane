# Contributing

Thanks for taking the time to improve ZT Control Plane. Small fixes, clearer
documentation, thoughtful provider integrations, and well-tested features are
all valuable. You do not need to understand the whole codebase before helping.

## A good contribution

- Keep the project independent and provider-neutral. Do not add ZeroTier or
  other vendor logos, imply endorsement, or copy proprietary UI assets.
- Use documented provider APIs and link the relevant official specification
  in the pull request.
- Never commit credentials, private identities, API responses containing
  personal infrastructure data, production database files, or screenshots
  with secrets.
- Keep the standard Docker target free of ZeroTier's `nonfree/` controller
  code. Any embedded-runtime change must preserve the explicit opt-in boundary
  and upstream notices.

## Get the project running

```sh
npm ci
npm run check
docker compose build control-plane
```

Add or update automated tests when behavior changes. If an action can change or
delete provider state, give the user a clear confirmation and make sure the
audit log identifies the target without ever recording credentials.

Application source is under `src/`. Place page-level UI in the matching
`src/features/<area>` directory, cross-feature React code in `src/shared`, API
routes in `src/app/api`, and provider/domain behavior in `src/lib`. Keep route
files thin and do not move deployment manifests away from the repository root.

`npm run check` also checks the reviewed dependency-license allowlist. When a
dependency introduces a new license, pause and understand it before updating
the allowlist.

## License of contributions

By submitting a contribution, you agree to license it under Apache-2.0, the
same license as the project. Do not submit code you do not have the right to
license on those terms. Third-party code must retain its original notices and
must be documented in `THIRD_PARTY_NOTICES.md`.

## Found a security issue?

Thank you for handling it carefully. Please avoid a public issue and follow
`SECURITY.md` so the report can be reviewed privately.
