# Optional embedded controller: licensing and distribution

The embedded profile is convenient for a self-contained lab: one container can
run both the control plane and a local ZeroTier controller. It is optional for a
reason, though—the controller code comes with different upstream terms.

This page helps you make that choice deliberately. It applies only to the
`embedded-runtime` Docker target and `compose.embedded.yaml`; the standard image
does not contain ZeroTier One.

## Why there are two images

ZeroTier One 1.16.2 contains components under different licenses. Upstream's
top-level notice states that most agent code is MPL-2.0, `ext/` retains its
individual licenses, and `nonfree/` is covered by a separate source-available
license. The embedded controller is compiled from that `nonfree/` code by
setting `ZT_NONFREE=1`.

The ZeroTier Source-Available License 1.0 says that its controller code is not
open source. Its no-cost grant is limited to the license's definition of
non-commercial use. The definition classifies use by or for companies,
government, non-profits, business development/staging/production, services,
and incorporation into a product or distribution as commercial. Such use
requires a separate commercial agreement with ZeroTier, Inc.

Before building, read the authoritative upstream files for your intended use:

- <https://github.com/zerotier/ZeroTierOne/blob/1.16.2/LICENSE.txt>
- <https://github.com/zerotier/ZeroTierOne/blob/1.16.2/LICENSE-MPL.txt>
- <https://github.com/zerotier/ZeroTierOne/blob/1.16.2/nonfree/LICENSE.md>

If these notes and the upstream text differ, the upstream license controls.

## Build behavior

The overlay downloads the official 1.16.2 source archive, verifies the pinned
SHA-256 checksum, and builds unmodified ZeroTier binaries. The resulting image
contains the upstream license texts in `/usr/share/licenses/zerotier-one` and
the corresponding source is identified by the exact version and checksum in
the Dockerfile/Compose configuration.

The image is built locally only when the operator explicitly selects the
overlay:

```sh
docker compose -f compose.yaml -f compose.embedded.yaml build
```

For platforms that accept one Compose file, use the equivalent standalone
deployment:

```sh
docker compose -f compose.embedded.standalone.yaml up -d --build
```

Both variants persist application data and the complete ZeroTier state under
the `control-plane-data` volume mounted at `/data`. Back up that volume before
upgrades or deployment changes. Embedded mode requires `/dev/net/tun` plus the
declared `NET_ADMIN` and `SYS_ADMIN` capabilities to participate as a client
node as well as operate the controller.

The project does not plan to publish this target as its standard open-source
container artifact. A redistributor must independently ensure that its use,
binary distribution, source availability, notices, trademarks, and any
commercial license satisfy all applicable upstream terms.

## Trademark boundary

This project does not use ZeroTier logos or claim to be an official ZeroTier
product. “ZeroTier” is used descriptively for compatible APIs and components.
Do not remove upstream notices, imply endorsement, or rebrand upstream
software in a way that causes confusion about source or sponsorship.

## The practical choice

- Use the standard image to manage external controllers under this project's
  Apache-2.0 terms and the applicable terms of its open-source dependencies and
  provider APIs/services.
- Use the embedded target only after reviewing the upstream license for the
  exact operator and environment.
- Obtain a separate ZeroTier license before any use that the upstream license
  defines as commercial.
- Seek qualified legal advice before publishing an embedded image or offering
  a service based on it.

For most installations, the standard image plus a remote controller is the
easiest path. This document is operational guidance, not legal advice.
