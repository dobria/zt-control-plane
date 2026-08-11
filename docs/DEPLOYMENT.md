# Deployment

Pick the Docker environment you are comfortable operating. ZT Control Plane is
not tied to a hosting panel: the same image works with Docker Compose, a
container platform, or an application host that can provide persistent storage.

The recipe is straightforward: one container, one persistent `/data` volume,
and HTTPS in front. Start with the standard profile unless you specifically
need the optional embedded controller.

## The recommended setup

The default `runtime` image contains the Apache-2.0 web application and its
open-source runtime dependencies. Versioned standard images are published from
immutable release tags to both registries:

- `ghcr.io/dobria/zt-control-plane`
- `docker.io/dobria/zt-control-plane`

Both names refer to the same release build. The supplied Compose file uses
GHCR by default. Set `CONTROL_PLANE_IMAGE=dobria/zt-control-plane:0.1.2` if you
prefer Docker Hub.
It listens on TCP 3000, stores state below `/data/app`, and requires no TUN
device or elevated network capabilities. The supplied Compose service also
runs it as an unprivileged user with a read-only root filesystem, no Linux
capabilities, `no-new-privileges`, and a bounded temporary filesystem.

For the current release:

```sh
curl -fsSLO https://raw.githubusercontent.com/dobria/zt-control-plane/v0.1.2/compose.release.yaml
curl -fsSLO https://raw.githubusercontent.com/dobria/zt-control-plane/v0.1.2/.env.example
cp .env.example .env
docker compose -f compose.release.yaml up -d
```

The release Compose file pins the full `0.1.2` image tag. Avoid deploying only
`latest` when repeatability matters. For the strongest pin, replace the image
tag with the digest published in the corresponding GitHub Release.

To inspect and build the standard runtime locally, clone the same release tag
and use `docker compose up -d --build` with `compose.yaml`.

A solid production setup looks like this:

- one application replica;
- a persistent volume mounted at `/data`;
- HTTPS termination at a trusted reverse proxy;
- a stable `APP_SECRET` of at least 32 random characters;
- a separate `APP_SETUP_TOKEN` of at least 24 random characters for a new
  installation, or secure access to the generated token in the first-start log;
- `APP_PUBLIC_URL=https://control.example.com`;
- `APP_SECURE_COOKIES=1`;
- backups of the complete data volume.

Run one application replica. SQLite is a good fit for this private control
plane, but multiple writers sharing one volume are not a supported topology.

## Put HTTPS in front

Keep the application port reachable only from the proxy or a trusted private
network. Set `TRUST_PROXY=1` only when the proxy replaces, rather than appends
to, forwarded address and protocol headers. `APP_PUBLIC_URL` is mandatory in
that mode and must match the browser origin exactly.

The web IP allowlist relies on this trusted proxy boundary. Turn it on from an
existing session and keep a recovery route until you have confirmed the detected
client address. `/api/health` stays outside authentication and IP filtering so
your container platform can still check readiness.

## Ports

| Mode     | Required port         | Purpose            |
| -------- | --------------------- | ------------------ |
| Standard | `3000/tcp` internally | Web UI and API     |
| Embedded | `3000/tcp` internally | Web UI and API     |
| Embedded | `9993/udp` internally | ZeroTier transport |

The local Compose example publishes the web service as `3100/tcp`. A reverse
proxy platform may omit direct host publishing and attach to port 3000 over a
private container network.

## Optional embedded mode

The embedded deployment additionally needs `/dev/net/tun`, `NET_ADMIN`,
`SYS_ADMIN`, `NET_RAW`, and a directly published UDP port. `SYS_ADMIN` is a
broad capability, so use embedded mode only on a host and trust boundary where
that access is acceptable. It builds and includes upstream ZeroTier One code
governed by separate licenses. For a single-file deployment:

```sh
docker compose -f compose.embedded.standalone.yaml up -d --build
```

The equivalent overlay-based command is:

```sh
docker compose -f compose.yaml -f compose.embedded.yaml up -d --build
```

Read [Embedded controller licensing](EMBEDDED_CONTROLLER.md) first. The
embedded image is intentionally not a public registry artifact. Build it
locally only after reviewing the separate licensing and privilege boundary.

## Coolify example

Coolify is one possible deployment platform, not a product dependency or the
project's target identity.

1. Deploy the repository as a Docker Compose application.
2. Persist the named `/data` volume.
3. Route the domain to container TCP 3000 and enable HTTPS.
4. Supply the production environment variables described above as secrets.
5. For the standard mode, use `compose.yaml` only.
6. For embedded mode, select `compose.embedded.standalone.yaml`; confirm that
   the host exposes `/dev/net/tun` and permits the declared capabilities and
   UDP publishing.
7. Keep the `control-plane-data` volume across every deployment. It contains
   both `/data/app` and `/data/zerotier`; removing it changes the embedded node
   identity and loses controller state.

`WEB_PORT` is useful for direct Compose publishing but may be unnecessary when
Coolify connects through its internal proxy network. Never expose the internal
ZeroTier Service API over TCP to the public internet.

## A quick confidence check

After deployment, take a minute to confirm the full path works:

1. Verify `/api/health` returns HTTP 200.
2. Retrieve the setup token from the protected deployment secret or first-start
   log and complete `/setup` on a new volume.
3. Add a controller and use **Test connection**.
4. Confirm a read operation from Networks and Nodes.
5. Verify HTTPS, secure-cookie behavior, login, logout, and backup creation.
6. In embedded mode, also verify the local controller, local node, persistent
   identity, and external UDP reachability.
