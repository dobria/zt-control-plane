# syntax=docker/dockerfile:1.7

ARG ZEROTIER_VERSION=1.16.2
ARG ZEROTIER_SHA256=2c607f573c6e38815433af289d364a689a203b18b51125f06c4472014d0657f0

FROM rust:1.97-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3 AS zerotier-builder
ARG ZEROTIER_VERSION
ARG ZEROTIER_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl libssl-dev libsodium-dev pkg-config && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL "https://github.com/zerotier/ZeroTierOne/archive/refs/tags/${ZEROTIER_VERSION}.tar.gz" -o zerotier.tar.gz && \
    echo "${ZEROTIER_SHA256}  zerotier.tar.gz" | sha256sum --check --strict && \
    tar -xzf zerotier.tar.gz --strip-components=1 && \
    make -j"$(nproc)" ZT_NONFREE=1 zerotier-one zerotier-cli zerotier-idtool

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && \
    mkdir -p /third-party-licenses && \
    find node_modules -type f \( -iname 'license' -o -iname 'license.*' -o -iname 'copying' -o -iname 'copying.*' -o -iname 'notice' -o -iname 'notice.*' \) \
      -exec cp --parents '{}' /third-party-licenses/ \;

FROM dependencies AS web-builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime-base
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_DATA_DIR=/data/app \
    EMBEDDED_ZEROTIER=0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gosu tini && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 1001 controlplane && \
    useradd --system --uid 1001 --gid controlplane --home-dir /app controlplane && \
    mkdir -p /data/app && \
    chown controlplane:controlplane /data/app && \
    chmod 700 /data/app

WORKDIR /app
COPY --from=web-builder --chown=controlplane:controlplane /app/.next/standalone ./
COPY --from=web-builder --chown=controlplane:controlplane /app/.next/static ./.next/static
COPY --from=web-builder --chown=controlplane:controlplane /app/public ./public
COPY --from=dependencies --chown=controlplane:controlplane /app/node_modules/zerotier-rule-compiler ./node_modules/zerotier-rule-compiler
# The application serves its local QR data URL directly and disables Next image
# optimization. Remove Sharp/libvips optional packages from distributed images
# to avoid shipping an unused native image-processing stack.
RUN rm -rf node_modules/sharp node_modules/@img
COPY LICENSE NOTICE COPYRIGHT THIRD_PARTY_NOTICES.md /usr/share/licenses/zt-control-plane/
COPY licenses /usr/share/licenses/zt-control-plane/project-dependencies
COPY package-lock.json /usr/share/licenses/zt-control-plane/package-lock.json
COPY --from=dependencies /third-party-licenses /usr/share/licenses/zt-control-plane/dependencies
COPY --chmod=755 docker/entrypoint-web.sh /usr/local/bin/control-plane-entrypoint

VOLUME ["/data"]
EXPOSE 3000/tcp
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/control-plane-entrypoint"]

# This target is intentionally opt-in. It contains ZeroTier's source-available
# controller code and is not the default open-source image.
FROM runtime-base AS embedded-runtime
LABEL org.opencontainers.image.title="ZT Control Plane (embedded profile)" \
      org.opencontainers.image.description="Community control plane with an optional upstream-licensed ZeroTier One runtime" \
      org.opencontainers.image.licenses="Apache-2.0 AND GPL-2.0-only AND MPL-2.0 AND LicenseRef-ZeroTier-Source-Available-1.0"
ENV EMBEDDED_ZEROTIER=1 \
    ZT_LOCAL_API_URL=http://127.0.0.1:9993 \
    ZT_LOCAL_TOKEN_PATH=/var/lib/zerotier-one/authtoken.secret
RUN apt-get update && apt-get install -y --no-install-recommends \
    iproute2 iptables && \
    rm -rf /var/lib/apt/lists/*
COPY --from=zerotier-builder /src/zerotier-one /usr/sbin/zerotier-one
COPY --from=zerotier-builder /src/zerotier-cli /usr/sbin/zerotier-cli
COPY --from=zerotier-builder /src/zerotier-idtool /usr/sbin/zerotier-idtool
COPY --from=zerotier-builder /src/LICENSE.txt /usr/share/licenses/zerotier-one/LICENSE.txt
COPY --from=zerotier-builder /src/LICENSE-MPL.txt /usr/share/licenses/zerotier-one/LICENSE-MPL.txt
COPY --from=zerotier-builder /src/nonfree/LICENSE.md /usr/share/licenses/zerotier-one/LICENSE-NONFREE.md
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/control-plane-entrypoint
EXPOSE 9993/udp

# Keep the fully open-source control-plane runtime as Docker's default target.
FROM runtime-base AS runtime
LABEL org.opencontainers.image.title="ZT Control Plane" \
      org.opencontainers.image.description="Independent multi-provider network control plane" \
      org.opencontainers.image.licenses="Apache-2.0 AND GPL-2.0-only"
USER controlplane:controlplane
