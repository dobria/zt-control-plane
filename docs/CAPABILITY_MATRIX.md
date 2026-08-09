# ZeroTier capability matrix

Not every ZeroTier-compatible endpoint speaks the same management language.
This page gives you the practical answer to “will this control appear for my
controller?” and points to the official API behind each integration.

The matrix covers ZeroTier One 1.16.2, both official Central APIs, and the
RouterOS ZeroTier interface. A missing control is usually an upstream API
difference, not a hidden product tier in ZT Control Plane.

Primary references:

- [ZeroTier One Service API](https://docs.zerotier.com/api/client/)
- [Service API OpenAPI document](https://docs.zerotier.com/openapi/service/v1.json)
- [ZeroTier CLI](https://docs.zerotier.com/cli/)
- [ZeroTier on RouterOS](https://help.mikrotik.com/docs/spaces/ROS/pages/83755083/ZeroTier)
- [New Central API v2](https://docs.zerotier.com/api/central/new/)
- [Legacy Central API v1](https://docs.zerotier.com/api/central/legacy/)
- [ZeroTier API tokens](https://docs.zerotier.com/tokens/)

## Implemented

### Network controllers

| Capability                      | Embedded One         | Remote One           | MikroTik Controller       | New Central          | Legacy Central       |
| ------------------------------- | -------------------- | -------------------- | ------------------------- | -------------------- | -------------------- |
| Connection registry/test/select | Optional profile     | Yes                  | Yes                       | Yes                  | Yes                  |
| ZeroTier instance CRUD          | —                    | —                    | Multiple instances        | —                    | —                    |
| Network groups                  | —                    | —                    | —                         | Full CRUD and select | —                    |
| Network CRUD                    | Full                 | Full                 | RouterOS-supported        | Full                 | Full                 |
| Member CRUD and authorization   | Full                 | Full                 | RouterOS-supported fields | Full                 | Full                 |
| Manual member add               | Yes                  | Yes                  | Yes                       | Yes                  | Yes                  |
| Routes and IP assignment        | Full                 | Full                 | RouterOS-supported        | Full                 | Full                 |
| Managed DNS                     | Yes                  | Yes                  | No                        | Yes                  | Yes                  |
| IPv6 RFC4193 / 6PLANE           | Yes                  | Yes                  | Yes                       | Yes                  | Yes                  |
| Flow Rules                      | Templates/source/raw | Templates/source/raw | No                        | Templates/source/raw | Templates/source/raw |
| Tags and capabilities           | Yes                  | Yes                  | No                        | Yes                  | Yes                  |
| Raw provider configuration      | Yes                  | Yes                  | Yes                       | Yes                  | Yes                  |

New Central features remain subject to the plan and permissions attached to its
service-account token. Flow Rules are submitted through the official v2 beta
endpoint used by New Central.

### Managed nodes

Node operations are opened from the corresponding optional Embedded ZeroTier One,
Remote ZeroTier One, or MikroTik controller card. Central devices are shown as
network members because neither Central API exposes the clients' local Service
API.

| Capability                                     | Local node | Remote ZeroTier One client | MikroTik client instance    |
| ---------------------------------------------- | ---------- | -------------------------- | --------------------------- |
| Connection registry/test/select                | Optional   | Yes                        | Yes                         |
| Status and identity                            | Yes        | Yes                        | Yes                         |
| Joined-network list/join/update/leave          | Yes        | Yes                        | Yes                         |
| Interface enabled/comment/name/VRF/ARP timeout | —          | —                          | Yes                         |
| `allowManaged`, `allowDefault`, `allowGlobal`  | Yes        | Yes                        | Yes                         |
| `allowDNS`                                     | Yes        | Yes                        | RouterOS does not expose it |
| Peer/path diagnostics                          | Yes        | Yes                        | Per-instance RouterOS peers |
| Moon list/orbit/deorbit                        | Yes        | Yes                        | RouterOS does not expose it |

## Good ideas for later

These features are useful, but each needs a little more safety or product work
before it belongs in a dependable control plane.

| Function                            | Priority | Reason                                                                                                                                                                           |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node-wide `/config/settings` editor | Medium   | Some values change listening ports, relays, interface binding or multipath and may require a service restart. It needs validation plus a provider-neutral recovery workflow.     |
| Prometheus `/metrics` integration   | Medium   | Useful for monitoring, but it is observability rather than controller CRUD. It should be implemented as charts and a protected scrape endpoint.                                  |
| Dedicated peer detail route         | Low      | The public API is read-only and the useful fields are already shown in Diagnostics.                                                                                              |
| Debug dump generation               | Low      | The CLI warns that dumps can contain physical IPs and public identities. Export needs redaction and an explicit sensitive-data warning.                                          |
| Multipath bonding controls          | Low      | The endpoints are internal implementation endpoints and are not part of the published Service API specification.                                                                 |
| Planet/moon generation              | Low      | `zerotier-idtool` generation is a file/identity provisioning workflow, not a normal Service API CRUD operation. It should be a separate guarded wizard with backup requirements. |

## How the interface stays current

Read-only operational pages refresh when they are opened, when the browser regains
focus, when the device comes back online and on a short interval while visible.
Network forms pause background refresh while a modal is open or the current draft
has unsaved changes. Network tabs are stored in the `tab` URL query parameter, so a
browser refresh returns to the same tab.

The global **Networks** and **Nodes** catalogs span every registered controller.
Provider scope, search, state, authorization, view and pagination selections are
URL-persistent. A short response cache and sanitized SQLite discovery snapshots
keep large multi-controller workspaces usable during partial provider outages;
all mutations still target the live provider adapter directly.
