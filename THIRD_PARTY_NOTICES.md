# Third-party notices

ZT Control Plane is an independent community project. It is not affiliated
with, sponsored by, or endorsed by ZeroTier, Inc. “ZeroTier” is a trademark
of ZeroTier, Inc. Its use in this project describes interoperability only.

The application source is Apache-2.0. Flow-rule validation invokes the
`zerotier-rule-compiler` package, version 1.2.2-2, as a separate command-line
program. That package declares GPL-2.0 and remains under its own terms. Its
complete package source is included in distributed images, its upstream source
is <https://github.com/zerotier/ZeroTierOne/tree/rule-compiler>, and the GPL
version 2 text is included at `licenses/GPL-2.0-only.txt` and in the container
dependency license bundle.

Other direct runtime dependencies declare the following licenses:

| Dependency | Version | Declared license |
| --- | ---: | --- |
| Next.js | 16.3.0 | MIT |
| React | 19.2.8 | MIT |
| React DOM | 19.2.8 | MIT |
| Lucide React | 1.30.0 | ISC |
| QRCode | 1.5.4 | MIT |
| Undici | 8.10.0 | MIT |

The exact resolved dependency graph and versions are recorded in
`package-lock.json`. Container images include the license and notice files
shipped by installed npm dependencies under
`/usr/share/licenses/zt-control-plane/dependencies`.

Next.js declares Sharp and libvips platform packages as optional dependencies.
This application disables image optimization and its distributed images remove
those optional binaries; the QR enrollment image is rendered directly from a
locally generated data URL. They remain visible in the lockfile so clean npm
development installs stay reproducible across supported platforms.

## Optional embedded ZeroTier One build

The default image does not contain ZeroTier One. The optional
`embedded-runtime` target downloads and builds the unmodified ZeroTier One
1.16.2 source archive. Upstream separates that repository into components
with different terms:

- the ZeroTier Agent and most of the repository are MPL-2.0;
- the controller and related code in `nonfree/` are governed by the
  ZeroTier Source-Available License 1.0;
- code under `ext/` retains its own licenses.

The embedded target is built with `ZT_NONFREE=1`. Its controller code is not
open source, and the upstream license limits unlicensed use to the defined
non-commercial cases. Commercial use requires a separate agreement with
ZeroTier, Inc. The embedded image includes the upstream `LICENSE.txt`,
`LICENSE-MPL.txt`, and `nonfree/LICENSE.md` files under
`/usr/share/licenses/zerotier-one`.

Project licensing does not replace, extend, or narrow any third-party terms.
Operators and redistributors are responsible for complying with every license
that applies to the mode and artifacts they use.
