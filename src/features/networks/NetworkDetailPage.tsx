"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  Clipboard,
  Code2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import {
  ControllerContext,
  useSynchronizeControllerScope,
} from "@/shared/providers/ControllerContext";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import { MemberDialog } from "@/features/networks/network-detail/MemberDialog";
import { SaveBar } from "@/features/networks/network-detail/SaveBar";
import {
  clone,
  defaultPolicy,
  emptyMember,
  generateFlowSource,
  generatedSubnet,
  memberDraftFrom,
  normalizeRemoteTraceTarget,
  ruleStarters,
  serviceOptions,
  type FlowPolicy,
  type MemberDraft,
  type Metadata,
} from "@/features/networks/network-detail/model";
import type { NetworkTab } from "@/lib/network-tabs";
import type {
  AdapterCapabilities,
  ManagedNetwork,
  NetworkMember,
} from "@/lib/types";

export function NetworkDetailPage({
  controllerId,
  networkId,
  initialTab,
}: {
  controllerId: string;
  networkId: string;
  initialTab: NetworkTab;
}) {
  const router = useRouter();
  const { permissions, settings } = useAuth();
  const controller = useSynchronizeControllerScope(controllerId);
  const isMikroTik = controller?.type === "mikrotik";
  const [network, setNetwork] = useState<ManagedNetwork | null>(null);
  const [draft, setDraft] = useState<ManagedNetwork | null>(null);
  const [members, setMembers] = useState<NetworkMember[]>([]);
  const [metadata, setMetadata] = useState<Metadata>({
    description: "",
    rulesSource: "",
    templatePolicy: null,
  });
  const [capabilities, setCapabilities] = useState<AdapterCapabilities | null>(
    null,
  );
  const [tab, setTab] = useState<NetworkTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberDraft, setMemberDraft] = useState<MemberDraft>(emptyMember);
  const [memberError, setMemberError] = useState("");
  const [flowMode, setFlowMode] = useState<"template" | "custom">("template");
  const [policy, setPolicy] = useState<FlowPolicy>(defaultPolicy);
  const [rulesSource, setRulesSource] = useState("accept;");
  const [rawJson, setRawJson] = useState("");
  const load = useCallback(
    async (silent = false, signal?: AbortSignal) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const result = await api<{
          network: ManagedNetwork;
          members: NetworkMember[];
          metadata: Metadata;
          capabilities: AdapterCapabilities;
        }>(`/api/controllers/${controllerId}/networks/${networkId}`, {
          signal,
        });
        if (signal?.aborted) return;
        const normalized = {
          ...result.network,
          routes: result.network.routes || [],
          ipAssignmentPools: result.network.ipAssignmentPools || [],
          v4AssignMode: result.network.v4AssignMode || {},
          v6AssignMode: result.network.v6AssignMode || {},
          dns: result.network.dns || [],
          rules: result.network.rules || [],
          capabilities: result.network.capabilities || [],
          tags: result.network.tags || [],
        };
        setNetwork(normalized);
        setDraft(clone(normalized));
        setMembers(result.members);
        setMetadata(result.metadata);
        setCapabilities(result.capabilities);
        setRawJson(JSON.stringify(normalized.raw || normalized, null, 2));
        const nextPolicy = result.metadata.templatePolicy || defaultPolicy;
        setPolicy(nextPolicy);
        setFlowMode(result.metadata.templatePolicy ? "template" : "custom");
        setRulesSource(
          result.metadata.rulesSource || generateFlowSource(nextPolicy),
        );
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error ? caught.message : "Unable to load network.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [controllerId, networkId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    if (!capabilities || capabilities.flowRules || tab !== "rules") return;
    setTab("members");
    router.replace(
      `/networks/${encodeURIComponent(controllerId)}/${encodeURIComponent(networkId)}?tab=members`,
      { scroll: false },
    );
  }, [capabilities, controllerId, networkId, router, tab]);
  const filteredMembers = useMemo(
    () =>
      members.filter((member) =>
        `${member.name} ${member.comment || ""} ${member.id} ${(member.ipAssignments || []).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [members, query],
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!network || !draft) return false;
    const savedPolicy = metadata.templatePolicy || defaultPolicy;
    const savedRules =
      metadata.rulesSource || generateFlowSource(savedPolicy as FlowPolicy);
    return (
      JSON.stringify(draft) !== JSON.stringify(network) ||
      metadata.description !== String(network.description || "") ||
      rawJson !== JSON.stringify(network.raw || network, null, 2) ||
      flowMode !== (metadata.templatePolicy ? "template" : "custom") ||
      JSON.stringify(policy) !== JSON.stringify(savedPolicy) ||
      rulesSource !== savedRules
    );
  }, [draft, flowMode, metadata, network, policy, rawJson, rulesSource]);
  useEffect(() => {
    document.documentElement.dataset.unsavedControllerChanges =
      String(hasUnsavedChanges);
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      delete document.documentElement.dataset.unsavedControllerChanges;
    };
  }, [hasUnsavedChanges]);
  useAutoRefresh(
    async (signal) => {
      if (busy || memberOpen || hasUnsavedChanges) return;
      await load(true, signal);
    },
    {
      enabled: Boolean(network),
      intervalMs: settings.refreshSeconds * 1000,
      refreshKey: `${controllerId}:${networkId}`,
      runImmediately: false,
    },
  );
  function selectTab(nextTab: NetworkTab) {
    setTab(nextTab);
    router.replace(
      `/networks/${encodeURIComponent(controllerId)}/${encodeURIComponent(networkId)}?tab=${nextTab}`,
      { scroll: false },
    );
  }
  function notice(value: string) {
    setMessage(value);
    window.setTimeout(() => setMessage(""), 3200);
  }
  async function saveNetwork(
    success = "Network configuration saved.",
    value: Partial<ManagedNetwork> = draft || {},
  ) {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ network: ManagedNetwork }>(
        `/api/controllers/${controllerId}/networks/${networkId}`,
        jsonRequest("PUT", { ...value, description: metadata.description }),
      );
      const normalized = { ...draft, ...result.network };
      setNetwork(normalized);
      setDraft(clone(normalized));
      setRawJson(JSON.stringify(normalized.raw || normalized, null, 2));
      notice(success);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save network.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteNetwork() {
    if (
      !network ||
      !confirm(
        `Delete “${network.name}” (${networkId}) from ${controller?.name || controllerId}? This permanently deletes its controller record and members.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/api/controllers/${controllerId}/networks/${networkId}`, {
        method: "DELETE",
      });
      router.push("/networks");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete network.",
      );
      setBusy(false);
    }
  }
  async function openMember(member?: NetworkMember) {
    setMemberError("");
    if (!member) {
      setMemberDraft(emptyMember());
      setMemberOpen(true);
      return;
    }
    setMemberDraft(memberDraftFrom(member));
    setMemberOpen(true);
    try {
      const result = await api<{
        member: NetworkMember & { description?: string };
      }>(
        `/api/controllers/${controllerId}/networks/${networkId}/members/${member.id}`,
      );
      setMemberDraft(memberDraftFrom(result.member));
    } catch (caught) {
      setMemberError(
        caught instanceof Error
          ? caught.message
          : "Unable to load the latest member details.",
      );
    }
  }
  async function saveMember(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMemberError("");
    try {
      const body: Record<string, unknown> = {
        id: memberDraft.id,
        authorized: memberDraft.authorized,
        description: memberDraft.description,
      };
      if (capabilities?.memberDetails) {
        Object.assign(body, {
          name: memberDraft.name,
          activeBridge: memberDraft.activeBridge,
        });
        if (isMikroTik)
          Object.assign(body, {
            comment: memberDraft.comment,
            disabled: memberDraft.disabled,
          });
        else
          Object.assign(body, {
            noAutoAssignIps: memberDraft.noAutoAssignIps,
            ssoExempt: memberDraft.ssoExempt,
            authenticationExpiryTime: memberDraft.authenticationExpiryTime,
            remoteTraceLevel: memberDraft.remoteTraceLevel,
            remoteTraceTarget: memberDraft.remoteTraceTarget,
          });
      }
      if (capabilities?.memberIpAssignments)
        body.ipAssignments = memberDraft.ipAssignments;
      if (capabilities?.tagsAndCapabilities) {
        body.capabilities = JSON.parse(memberDraft.capabilitiesJson);
        body.tags = JSON.parse(memberDraft.tagsJson);
      }
      const exists = members.some((item) => item.id === memberDraft.id);
      if (exists)
        await api(
          `/api/controllers/${controllerId}/networks/${networkId}/members/${memberDraft.id}`,
          jsonRequest("PUT", body),
        );
      else
        await api(
          `/api/controllers/${controllerId}/networks/${networkId}/members`,
          jsonRequest("POST", body),
        );
      setMemberOpen(false);
      await load(true);
      notice("Member record saved.");
    } catch (caught) {
      setMemberError(
        caught instanceof Error ? caught.message : "Unable to save member.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggleAuthorization(member: NetworkMember) {
    try {
      await api(
        `/api/controllers/${controllerId}/networks/${networkId}/members/${member.id}`,
        jsonRequest("PUT", { authorized: !member.authorized }),
      );
      setMembers((items) =>
        items.map((item) =>
          item.id === member.id
            ? { ...item, authorized: !item.authorized }
            : item,
        ),
      );
      notice(
        member.authorized ? "Member access revoked." : "Member authorized.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Authorization change failed.",
      );
    }
  }
  async function deleteMember(member: NetworkMember) {
    if (
      !confirm(
        `Delete member ${member.name || member.id} from ${network?.name || networkId} on ${controller?.name || controllerId}? It can reappear if the device reconnects.`,
      )
    )
      return;
    try {
      await api(
        `/api/controllers/${controllerId}/networks/${networkId}/members/${member.id}`,
        { method: "DELETE" },
      );
      setMembers((items) => items.filter((item) => item.id !== member.id));
      notice("Member record deleted. Reconnecting devices may appear again.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete member.",
      );
    }
  }
  function generateIPv4() {
    if (!draft) return;
    const next = generatedSubnet();
    const routes = [...(draft.routes || [])];
    const index = routes.findIndex(
      (route) => !route.via && /^\d/.test(route.target),
    );
    if (index >= 0) routes[index] = { target: next.route, via: null };
    else routes.unshift({ target: next.route, via: null });
    setDraft({
      ...draft,
      routes,
      ipAssignmentPools: [
        { ipRangeStart: next.start, ipRangeEnd: next.end },
        ...(draft.ipAssignmentPools || []).slice(1),
      ],
      v4AssignMode: { ...(draft.v4AssignMode || {}), zt: true },
    });
  }
  async function saveRules() {
    setBusy(true);
    setError("");
    const source =
      flowMode === "template" ? generateFlowSource(policy) : rulesSource;
    try {
      await api(
        `/api/controllers/${controllerId}/networks/${networkId}/rules`,
        jsonRequest("PUT", {
          source,
          templatePolicy: flowMode === "template" ? policy : null,
        }),
      );
      setRulesSource(source);
      await load(true);
      notice("Flow rules validated, compiled and distributed.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Flow Rules validation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveRaw() {
    try {
      const parsed = JSON.parse(rawJson) as ManagedNetwork;
      await saveNetwork("Raw controller configuration saved.", parsed);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Raw JSON is invalid.",
      );
    }
  }
  if (loading)
    return (
      <div className="section-stack">
        <div className="skeleton" />
        <div className="skeleton tall" />
      </div>
    );
  if (!network || !draft)
    return <div className="alert error">{error || "Network not found."}</div>;
  const dns = Array.isArray(draft.dns)
    ? { domain: "", servers: [] as string[] }
    : { domain: draft.dns?.domain || "", servers: draft.dns?.servers || [] };
  return (
    <>
      <ControllerContext controller={controller} section="Managed network" />
      <div className="page-heading">
        <div>
          <span className="eyebrow">Managed network</span>
          <h1>{network.name}</h1>
          <div className="network-title">
            <code>{networkId}</code>
            <button
              className="copy-button"
              onClick={() => void navigator.clipboard.writeText(networkId)}
              aria-label="Copy network ID"
            >
              <Clipboard />
            </button>
            <span className="status-pill neutral">
              {network.private ? "Private" : "Public"}
            </span>
            {isMikroTik && network.disabled && (
              <span className="status-pill disabled">Disabled</span>
            )}
            {network.instance && (
              <span className="status-pill neutral">
                Instance · {network.instance}
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <Link className="button" href="/networks">
            All networks
          </Link>
          {tab === "members" &&
            permissions.canWriteNetworks &&
            capabilities?.manualMemberAdd && (
              <button
                className="button primary"
                onClick={() => void openMember()}
              >
                <Plus /> Add member
              </button>
            )}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check />
          {message}
        </div>
      )}
      <div className="tabs">
        {[
          ["members", `Members (${members.length})`],
          ["network", "Network"],
          ["addresses", "IP assignment"],
          ["routes", "Routes & DNS"],
          ...(capabilities?.flowRules ? [["rules", "Flow rules"]] : []),
          ["raw", "Raw & danger"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => selectTab(id as NetworkTab)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <section className="card">
          <div className="card-header">
            <div>
              <span className="eyebrow">Member devices</span>
              <h2>Network access</h2>
              <p>
                {members.filter((item) => item.authorized).length} authorized of{" "}
                {members.length} registered
              </p>
            </div>
            <input
              className="input search-input"
              aria-label="Search members"
              placeholder="Search members…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filteredMembers.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name / ID</th>
                    <th>Authorization</th>
                    <th>{isMikroTik ? "Managed IP" : "Managed IPs"}</th>
                    {isMikroTik ? (
                      <>
                        <th>Bridge</th>
                        <th>State</th>
                        <th>Last seen</th>
                      </>
                    ) : (
                      <>
                        <th>Version</th>
                        <th>Last authorized</th>
                      </>
                    )}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.name || "Unnamed device"}</strong>
                        <br />
                        <code>{member.id}</code>
                        {isMikroTik && member.comment && (
                          <>
                            <br />
                            <small>{member.comment}</small>
                          </>
                        )}
                      </td>
                      <td>
                        <button
                          className={`status-pill ${member.authorized ? "" : "offline"}`}
                          disabled={!permissions.canWriteNetworks}
                          onClick={() => void toggleAuthorization(member)}
                        >
                          {member.authorized ? "Authorized" : "Denied"}
                        </button>
                      </td>
                      <td className="mono">
                        {member.ipAssignments?.join(", ") || "Auto / none"}
                      </td>
                      {isMikroTik ? (
                        <>
                          <td>{member.activeBridge ? "Allowed" : "No"}</td>
                          <td>
                            <span
                              className={`status-pill ${member.disabled ? "disabled" : ""}`}
                            >
                              {member.disabled ? "Disabled" : "Enabled"}
                            </span>
                          </td>
                          <td>{member.lastSeen || "Never"}</td>
                        </>
                      ) : (
                        <>
                          <td>{member.version || "—"}</td>
                          <td>
                            {member.lastAuthorizedTime
                              ? new Date(
                                  member.lastAuthorizedTime,
                                ).toLocaleString()
                              : "Never"}
                          </td>
                        </>
                      )}
                      <td>
                        <div className="actions">
                          <button
                            className="button small"
                            onClick={() => void openMember(member)}
                          >
                            View{permissions.canWriteNetworks ? " / edit" : ""}
                          </button>
                          {permissions.canWriteNetworks && (
                            <button
                              className="icon-button danger-icon"
                              onClick={() => void deleteMember(member)}
                              aria-label={`Delete ${member.name || member.id}`}
                            >
                              <Trash2 />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h2>
                {members.length ? "No matching members" : "No members yet"}
              </h2>
              <p>
                {!capabilities?.manualMemberAdd
                  ? "Members appear automatically after requesting access from this RouterOS controller."
                  : "Devices appear after requesting access, or can be added by node ID."}
              </p>
            </div>
          )}
        </section>
      )}

      {tab === "network" && (
        <div className="section-stack">
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Network details</span>
                <h2>Identity and transport</h2>
                <p>General controller configuration</p>
              </div>
            </div>
            <div className="card-body form-grid">
              <label className="field full">
                <span>Name</span>
                <input
                  className="input"
                  value={draft.name}
                  disabled={!permissions.canWriteNetworks}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <label className="field full">
                <span>
                  {isMikroTik ? "Control plane notes" : "Description"}
                </span>
                <textarea
                  className="textarea compact"
                  value={metadata.description}
                  disabled={!permissions.canWriteNetworks}
                  onChange={(event) =>
                    setMetadata({
                      ...metadata,
                      description: event.target.value,
                    })
                  }
                />
              </label>
              {isMikroTik && (
                <label className="field full">
                  <span>RouterOS comment</span>
                  <input
                    className="input"
                    value={String(draft.comment || "")}
                    maxLength={512}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({ ...draft, comment: event.target.value })
                    }
                  />
                </label>
              )}
              <>
                <label className="field">
                  <span>MTU</span>
                  <input
                    className="input"
                    type="number"
                    min={1280}
                    max={10000}
                    value={draft.mtu || 2800}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({ ...draft, mtu: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Multicast recipient limit</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={65535}
                    value={draft.multicastLimit || 32}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        multicastLimit: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </>
              <div className="field full switch-stack">
                {isMikroTik && (
                  <div className="switch-field">
                    <div>
                      <strong>Enabled</strong>
                      <small>
                        Keep this controller network enabled in RouterOS.
                      </small>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={!draft.disabled}
                        disabled={!permissions.canWriteNetworks}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            disabled: !event.target.checked,
                          })
                        }
                      />
                      <span />
                    </label>
                  </div>
                )}
                <div className="switch-field">
                  <div>
                    <strong>Private network</strong>
                    <small>Require explicit member authorization.</small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={draft.private}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({ ...draft, private: event.target.checked })
                      }
                    />
                    <span />
                  </label>
                </div>
                <div className="switch-field">
                  <div>
                    <strong>Enable broadcast</strong>
                    <small>
                      Send Ethernet broadcast packets to eligible members.
                    </small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={draft.enableBroadcast !== false}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          enableBroadcast: event.target.checked,
                        })
                      }
                    />
                    <span />
                  </label>
                </div>
              </div>
            </div>
          </section>
          {capabilities?.networkSso && (
            <section className="card">
              <div className="card-header">
                <div>
                  <span className="eyebrow">Advanced controller features</span>
                  <h2>SSO & remote tracing</h2>
                  <p>
                    Optional identity-provider authorization and distributed
                    trace delivery
                  </p>
                </div>
              </div>
              <div className="card-body section-stack">
                <div className="switch-field">
                  <div>
                    <strong>Enable network SSO</strong>
                    <small>
                      Require authorization through the configured identity
                      endpoint.
                    </small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.ssoEnabled)}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          ssoEnabled: event.target.checked,
                        })
                      }
                    />
                    <span />
                  </label>
                </div>
                <div className="form-grid">
                  <label className="field">
                    <span>Authorization endpoint</span>
                    <input
                      className="input"
                      type="url"
                      value={String(draft.authorizationEndpoint || "")}
                      disabled={
                        !permissions.canWriteNetworks || !draft.ssoEnabled
                      }
                      placeholder="https://identity.example/authorize"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          authorizationEndpoint: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>OIDC client ID</span>
                    <input
                      className="input mono"
                      value={String(draft.clientId || "")}
                      disabled={
                        !permissions.canWriteNetworks || !draft.ssoEnabled
                      }
                      onChange={(event) =>
                        setDraft({ ...draft, clientId: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Remote trace target</span>
                    <input
                      className="input mono"
                      value={String(draft.remoteTraceTarget || "")}
                      disabled={!permissions.canWriteNetworks}
                      maxLength={10}
                      pattern="[0-9a-fA-F]{10}"
                      placeholder="10-character node ID"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          remoteTraceTarget: normalizeRemoteTraceTarget(
                            event.target.value,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Remote trace level</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={Number(draft.remoteTraceLevel || 0)}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          remoteTraceLevel: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </section>
          )}
          {permissions.canWriteNetworks && (
            <SaveBar
              busy={busy}
              target={controller?.name || controllerId}
              onReset={() => {
                setDraft(clone(network));
                setMetadata((value) => ({
                  ...value,
                  description: String(network.description || value.description),
                }));
              }}
              onSave={() => void saveNetwork()}
            />
          )}
        </div>
      )}

      {tab === "addresses" && (
        <div className="section-stack">
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">IPv4 assignment</span>
                <h2>Managed pools</h2>
                <p>Ranges used for automatic addressing</p>
              </div>
              {permissions.canWriteNetworks && (
                <button className="button small" onClick={generateIPv4}>
                  <RefreshCw /> Generate /24
                </button>
              )}
            </div>
            <div className="card-body section-stack">
              {capabilities?.v4AutoAssignMode && (
                <div className="switch-field">
                  <div>
                    <strong>Auto-assign IPv4</strong>
                    <small>Allocate addresses from the pools below.</small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.v4AssignMode?.zt)}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          v4AssignMode: {
                            ...(draft.v4AssignMode || {}),
                            zt: event.target.checked,
                          },
                        })
                      }
                    />
                    <span />
                  </label>
                </div>
              )}
              <div className="subsection-heading">
                <div>
                  <strong>Assignment pools</strong>
                  <small>
                    {!capabilities?.multipleIpPools
                      ? "RouterOS supports one IPv4 assignment range per controller network."
                      : "Ranges should be contained in a managed route."}
                  </small>
                </div>
                {permissions.canWriteNetworks &&
                  (capabilities?.multipleIpPools ||
                    !(draft.ipAssignmentPools || []).length) && (
                    <button
                      className="button small"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          ipAssignmentPools: [
                            ...(draft.ipAssignmentPools || []),
                            { ipRangeStart: "", ipRangeEnd: "" },
                          ],
                        })
                      }
                    >
                      <Plus /> Add pool
                    </button>
                  )}
              </div>
              <div className="inline-list">
                {(draft.ipAssignmentPools || []).map((pool, index) => (
                  <div className="inline-row" key={index}>
                    <input
                      className="input mono"
                      placeholder="Start IP"
                      value={pool.ipRangeStart}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          ipAssignmentPools: draft.ipAssignmentPools?.map(
                            (item, idx) =>
                              idx === index
                                ? { ...item, ipRangeStart: event.target.value }
                                : item,
                          ),
                        })
                      }
                    />
                    <input
                      className="input mono"
                      placeholder="End IP"
                      value={pool.ipRangeEnd}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          ipAssignmentPools: draft.ipAssignmentPools?.map(
                            (item, idx) =>
                              idx === index
                                ? { ...item, ipRangeEnd: event.target.value }
                                : item,
                          ),
                        })
                      }
                    />
                    {permissions.canWriteNetworks && (
                      <button
                        className="icon-button danger-icon"
                        aria-label={`Remove IP assignment pool ${index + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            ipAssignmentPools: draft.ipAssignmentPools?.filter(
                              (_, idx) => idx !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">IPv6 assignment</span>
                <h2>Native modes</h2>
                <p>ZeroTier-generated and custom addressing</p>
              </div>
            </div>
            <div className="card-body switch-stack">
              {[
                ...(!capabilities?.customIpv6Pools
                  ? []
                  : [
                      [
                        "zt",
                        "Custom IPv6 pools",
                        "Allocate from IPv6 ranges in the pool list.",
                      ],
                    ]),
                [
                  "rfc4193",
                  "RFC4193 unique local",
                  "Assign a stable unique-local /128.",
                ],
                [
                  "6plane",
                  "6PLANE routed",
                  "Assign a routed /80 based on node identity.",
                ],
              ].map(([key, label, detail]) => (
                <div className="switch-field" key={key}>
                  <div>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.v6AssignMode?.[key])}
                      disabled={!permissions.canWriteNetworks}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          v6AssignMode: {
                            ...(draft.v6AssignMode || {}),
                            [key]: event.target.checked,
                          },
                        })
                      }
                    />
                    <span />
                  </label>
                </div>
              ))}
            </div>
          </section>
          {permissions.canWriteNetworks && (
            <SaveBar
              busy={busy}
              target={controller?.name || controllerId}
              onReset={() => setDraft(clone(network))}
              onSave={() => void saveNetwork("IP assignment saved.")}
            />
          )}
        </div>
      )}

      {tab === "routes" && (
        <div className="section-stack">
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Managed routes</span>
                <h2>Network reachability</h2>
                <p>
                  Leave gateway empty for the ZeroTier-managed subnet itself
                </p>
              </div>
              {permissions.canWriteNetworks && (
                <button
                  className="button small"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      routes: [
                        ...(draft.routes || []),
                        { target: "", via: null },
                      ],
                    })
                  }
                >
                  <Plus /> Add route
                </button>
              )}
            </div>
            <div className="card-body inline-list">
              {(draft.routes || []).map((route, index) => (
                <div className="inline-row route" key={index}>
                  <input
                    className="input mono"
                    placeholder="Destination CIDR"
                    value={route.target}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        routes: draft.routes?.map((item, idx) =>
                          idx === index
                            ? { ...item, target: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <input
                    className="input mono"
                    placeholder="Via member IP (optional)"
                    value={route.via || ""}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        routes: draft.routes?.map((item, idx) =>
                          idx === index
                            ? { ...item, via: event.target.value || null }
                            : item,
                        ),
                      })
                    }
                  />
                  {permissions.canWriteNetworks && (
                    <button
                      className="icon-button danger-icon"
                      aria-label={`Remove route ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          routes: draft.routes?.filter(
                            (_, idx) => idx !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          {capabilities?.managedDns && (
            <section className="card">
              <div className="card-header">
                <div>
                  <span className="eyebrow">DNS settings</span>
                  <h2>Managed name resolution</h2>
                  <p>
                    Search domain and resolver addresses delivered to clients
                  </p>
                </div>
              </div>
              <div className="card-body form-grid">
                <label className="field full">
                  <span>Search domain</span>
                  <input
                    className="input mono"
                    placeholder="home.arpa"
                    value={dns.domain}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dns: { ...dns, domain: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="field full">
                  <span>DNS servers</span>
                  <input
                    className="input mono"
                    placeholder="10.0.0.53, fd00::53"
                    value={dns.servers.join(", ")}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dns: {
                          ...dns,
                          servers: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
              </div>
            </section>
          )}
          {permissions.canWriteNetworks && (
            <SaveBar
              busy={busy}
              target={controller?.name || controllerId}
              onReset={() => setDraft(clone(network))}
              onSave={() => void saveNetwork("Routes and DNS saved.")}
            />
          )}
        </div>
      )}

      {tab === "rules" && capabilities?.flowRules && (
        <div className="section-stack">
          <section className="flow-intro">
            <div>
              <span className="eyebrow">Distributed access policy</span>
              <h2>Flow rules</h2>
              <p>
                Use a guided allow-list or the complete ZeroTier rule definition
                language.
              </p>
            </div>
            <div className="mode-switch">
              <button
                className={flowMode === "template" ? "active" : ""}
                onClick={() => setFlowMode("template")}
              >
                Template
              </button>
              <button
                className={flowMode === "custom" ? "active" : ""}
                onClick={() => {
                  if (flowMode === "template")
                    setRulesSource(generateFlowSource(policy));
                  setFlowMode("custom");
                }}
              >
                Custom source
              </button>
            </div>
          </section>
          {flowMode === "template" ? (
            <div className="rules-layout">
              <div className="section-stack">
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">Layer 2 protocol filter</span>
                      <h2>Ethernet guardrail</h2>
                      <p>Permit only IPv4, IPv6 and ARP frame types</p>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={policy.layer2Only}
                        disabled={!permissions.canWriteNetworks}
                        onChange={(event) =>
                          setPolicy({
                            ...policy,
                            layer2Only: event.target.checked,
                          })
                        }
                      />
                      <span />
                    </label>
                  </div>
                </section>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">Restrict traffic</span>
                      <h2>Service allow-list</h2>
                      <p>
                        Block all traffic except selected services and exempt
                        devices
                      </p>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={policy.restrict}
                        disabled={!permissions.canWriteNetworks}
                        onChange={(event) =>
                          setPolicy({
                            ...policy,
                            restrict: event.target.checked,
                          })
                        }
                      />
                      <span />
                    </label>
                  </div>
                  <div
                    className={`card-body section-stack ${policy.restrict ? "" : "disabled-content"}`}
                  >
                    <div className="service-grid">
                      {serviceOptions.map(([id, label, detail]) => (
                        <label className="check-card" key={id}>
                          <input
                            type="checkbox"
                            checked={policy.services.includes(id)}
                            disabled={
                              !permissions.canWriteNetworks || !policy.restrict
                            }
                            onChange={(event) =>
                              setPolicy({
                                ...policy,
                                services: event.target.checked
                                  ? [...policy.services, id]
                                  : policy.services.filter(
                                      (item) => item !== id,
                                    ),
                              })
                            }
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="subsection-heading">
                      <div>
                        <strong>Custom ports</strong>
                        <small>Single ports or ranges such as 8000-8010.</small>
                      </div>
                      {permissions.canWriteNetworks && (
                        <button
                          className="button small"
                          onClick={() =>
                            setPolicy({
                              ...policy,
                              custom: [
                                ...policy.custom,
                                { name: "", protocol: "tcp", port: "" },
                              ],
                            })
                          }
                        >
                          <Plus /> Add port
                        </button>
                      )}
                    </div>
                    {policy.custom.map((custom, index) => (
                      <div className="custom-port-row" key={index}>
                        <input
                          className="input"
                          placeholder="Service"
                          value={custom.name}
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              custom: policy.custom.map((item, idx) =>
                                idx === index
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                        <select
                          className="select"
                          value={custom.protocol}
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              custom: policy.custom.map((item, idx) =>
                                idx === index
                                  ? {
                                      ...item,
                                      protocol: event.target.value as
                                        "tcp" | "udp" | "both",
                                    }
                                  : item,
                              ),
                            })
                          }
                        >
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                          <option value="both">Both</option>
                        </select>
                        <input
                          className="input mono"
                          placeholder="Port / range"
                          value={custom.port}
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              custom: policy.custom.map((item, idx) =>
                                idx === index
                                  ? { ...item, port: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                        <button
                          className="icon-button danger-icon"
                          aria-label={`Remove custom service ${index + 1}`}
                          onClick={() =>
                            setPolicy({
                              ...policy,
                              custom: policy.custom.filter(
                                (_, idx) => idx !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">Exceptions</span>
                      <h2>Exempt devices</h2>
                      <p>Bypass template restrictions in both directions</p>
                    </div>
                  </div>
                  <div className="card-body service-grid">
                    {members.map((member) => (
                      <label className="check-card" key={member.id}>
                        <input
                          type="checkbox"
                          checked={policy.exemptMembers.includes(member.id)}
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              exemptMembers: event.target.checked
                                ? [...policy.exemptMembers, member.id]
                                : policy.exemptMembers.filter(
                                    (item) => item !== member.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          <strong>{member.name || member.id}</strong>
                          <small className="mono">{member.id}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
              <aside className="card rule-preview">
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Generated source</span>
                    <h2>Policy preview</h2>
                  </div>
                  <ShieldCheck />
                </div>
                <pre>{generateFlowSource(policy)}</pre>
              </aside>
            </div>
          ) : (
            <div className="grid two">
              <section className="card">
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Rule definition language</span>
                    <h2>Custom source</h2>
                    <p>Actions, matches, tags, capabilities and macros</p>
                  </div>
                  <Code2 />
                </div>
                <div className="card-body">
                  <div className="starter-row">
                    {Object.entries(ruleStarters).map(([label, source]) => (
                      <button
                        className="button small"
                        key={label}
                        onClick={() => setRulesSource(source)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="textarea mono rules-editor"
                    spellCheck={false}
                    value={rulesSource}
                    disabled={!permissions.canWriteNetworks}
                    onChange={(event) => setRulesSource(event.target.value)}
                  />
                </div>
              </section>
              <section className="card">
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Compiled state</span>
                    <h2>Controller policy</h2>
                    <p>Current structures distributed to members</p>
                  </div>
                </div>
                <div className="card-body">
                  <dl className="detail-list">
                    <div>
                      <dt>Rules</dt>
                      <dd>{draft.rules?.length || 0}</dd>
                    </div>
                    <div>
                      <dt>Capabilities</dt>
                      <dd>{draft.capabilities?.length || 0}</dd>
                    </div>
                    <div>
                      <dt>Tags</dt>
                      <dd>{draft.tags?.length || 0}</dd>
                    </div>
                  </dl>
                  <pre className="compiled-preview">
                    {JSON.stringify(
                      { capabilities: draft.capabilities, tags: draft.tags },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </section>
            </div>
          )}
          {permissions.canWriteNetworks && (
            <div className="sticky-actions">
              <span>
                Syntax is validated before the active policy is replaced.
              </span>
              <button
                className="button"
                onClick={() => {
                  setPolicy(defaultPolicy);
                  setRulesSource("accept;");
                }}
              >
                Restore default
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void saveRules()}
              >
                {busy ? "Validating…" : "Validate & save"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "raw" && (
        <div className="section-stack">
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Provider object</span>
                <h2>Raw configuration</h2>
                <p>
                  Advanced access to writable fields supported by this
                  controller adapter
                </p>
              </div>
              <Code2 />
            </div>
            <div className="card-body">
              <textarea
                className="textarea mono raw-editor"
                value={rawJson}
                disabled={!permissions.canWriteNetworks}
                spellCheck={false}
                onChange={(event) => setRawJson(event.target.value)}
              />
              {permissions.canWriteNetworks && (
                <div className="form-actions">
                  <button
                    className="button"
                    onClick={() =>
                      setRawJson(
                        JSON.stringify(network.raw || network, null, 2),
                      )
                    }
                  >
                    Reset
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void saveRaw()}
                  >
                    Save raw JSON
                  </button>
                </div>
              )}
            </div>
          </section>
          {permissions.canWriteNetworks && (
            <section className="danger-zone">
              <div>
                <span className="eyebrow">Danger zone</span>
                <h2>Delete this network</h2>
                <p>
                  This removes its controller record and all member records. It
                  cannot be undone.
                </p>
              </div>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void deleteNetwork()}
              >
                <Trash2 /> Delete network
              </button>
            </section>
          )}
        </div>
      )}

      <MemberDialog
        open={memberOpen}
        busy={busy}
        error={memberError}
        canWrite={permissions.canWriteNetworks}
        controller={controller}
        capabilities={capabilities}
        members={members}
        draft={memberDraft}
        setDraft={setMemberDraft}
        onClose={() => setMemberOpen(false)}
        onSubmit={saveMember}
      />
    </>
  );
}
