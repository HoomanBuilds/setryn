"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { isAddress } from "viem";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SMALL, ConnectWalletButton, Empty, ProvenanceChip, StateDot } from "@/components/home/kit";
import { Chip, Panel, PanelHead, Row, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import {
  ACCOUNT_STATUS_LABEL,
  APPROVAL_STATUS_LABEL,
  CAPABILITIES,
  ORGANIZATION_ROLE_LIST,
  ORGANIZATION_SCHEMA,
  ROLE_LABEL,
  activeMembers,
  effectiveProposalStatus,
  networkLabel,
  organizationRecords,
  roleCan,
  shortHex,
  type ApprovalProposal,
  type ApprovalStatus,
  type Organization,
  type OrganizationMember,
  type OrganizationRecords,
  type OrganizationRole,
  type PolicyConstraints,
  type PolicyVersion,
  type StrategyAccount,
} from "@/lib/settings/organization";
import type { OrganizationAction } from "@/lib/settings/organization-protocol";
import { useOrganizationControl, type OrganizationControl } from "@/lib/settings/useOrganizationControl";
import { formatNumber } from "@/lib/terminal/format";

const EMPTY_ID = `0x${"0".repeat(64)}`;
const FIELD =
  "focus-ring mt-1 h-11 w-full rounded-md border border-line bg-inset px-2 text-xs text-ink transition-colors hover:border-line-strong disabled:opacity-50 lg:h-8";
const AMOUNT_PATTERN = /^\d+(\.\d{1,18})?$/;
const POLICY_CURRENCIES = ["USDC", "sUSD"] as const;
const APPROVER_ROLES: OrganizationRole[] = ["approver", "admin", "trader", "accountant"];

function stamp(iso: string | null): string {
  if (!iso) return "-";
  return `${iso.slice(8, 10)} ${new Date(iso).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${iso.slice(11, 16)}`;
}

function amount(value: string, currency: string): string {
  return `${formatNumber(Number(value), 0)} ${currency}`;
}

/* ---------------------------------------------------------------- workspace */

const CLOCK_STEP_MS = 15_000;

function subscribeClock(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, CLOCK_STEP_MS);
  return () => window.clearInterval(timer);
}

function readClock(): number {
  return Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS;
}

/** Wall clock in 15-second steps for proposal expiry; the server render treats nothing as expired. */
export function useControlClock(): number {
  return useSyncExternalStore(subscribeClock, readClock, () => 0);
}

/** Organization control for the connected wallet, narrowed to the organization the settings pages are showing. */
export interface OrgWorkspace {
  control: OrganizationControl;
  connected: boolean;
  organizations: Organization[];
  records: OrganizationRecords | null;
  /** The connected wallet's membership record in the selected organization. */
  me: OrganizationMember | null;
  /** The connected wallet's role while its membership is active. */
  role: OrganizationRole | null;
  writable: boolean;
  writeReason: string | null;
  select: (organizationId: string) => void;
}

export function useOrgWorkspace(): OrgWorkspace {
  const control = useOrganizationControl();
  const [selected, setSelected] = useState<string | null>(null);
  const snapshot = control.state?.snapshot ?? null;
  const organizations = snapshot ? [...snapshot.organizations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : [];
  const current = organizations.find((item) => item.id === selected) ?? organizations[0] ?? null;
  const records = snapshot && current ? organizationRecords(snapshot, current.id) : null;
  const me = records && control.member ? (records.members.find((member) => member.memberId === control.member) ?? null) : null;
  const write = control.state?.write ?? null;
  return {
    control,
    connected: control.member !== null,
    organizations,
    records,
    me,
    role: me && me.status === "active" ? me.role : null,
    writable: write?.allowed ?? false,
    writeReason: write ? write.reason : null,
    select: setSelected,
  };
}

type Outcome = { ok: true; result: unknown } | { ok: false };

/** Runs one signed action at a time for a panel and keeps the last refusal to show under it. */
function useRunner(control: OrganizationControl) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, action: OrganizationAction, params: Record<string, unknown>): Promise<Outcome> => {
    setBusy(key);
    setError(null);
    try {
      const response = await control.act(action, params);
      return { ok: true, result: response.result };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change was not applied.");
      return { ok: false };
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

type Runner = ReturnType<typeof useRunner>;

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-down">
      {error}
    </p>
  );
}

function Member({ address, me }: { address: string; me: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={address}>
      <span className="truncate">{shortHex(address, 8, 6)}</span>
      {address === me ? <Chip tone="brand">You</Chip> : null}
    </span>
  );
}

/** Status line over the organization sections: where the records come from and whether they can change here. */
export function OrgStatusNote({ workspace }: { workspace: OrgWorkspace }) {
  const state = workspace.control.state;
  if (!state) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-[11px] leading-relaxed text-faint">
      <ProvenanceChip kind="OBSERVED" title="Read from the organization control service." />
      <span className="tnum font-mono text-dim">{ORGANIZATION_SCHEMA}</span>
      <span className={`min-w-0 ${workspace.writable ? "" : "text-down"}`}>
        {workspace.writable
          ? `Every change is signed by a member's wallet on ${state.networkLabel}. Records as of ${stamp(state.snapshot.generatedAt)} UTC.`
          : `${workspace.writeReason ?? "Organization changes are disabled on this network"}. Records are read-only here.`}
      </span>
    </div>
  );
}

/** Renders the organization panels once a wallet is connected, records are loaded, and an organization exists. */
function OrgGate({ workspace, label, children }: { workspace: OrgWorkspace; label: string; children: (records: OrganizationRecords) => ReactNode }) {
  if (!workspace.connected) {
    return (
      <Panel label={label}>
        <Empty
          title="Connect a wallet to manage organizations"
          detail="Your wallet is your member identity. Organizations, roles, and approvals follow the address you sign with."
        >
          <ConnectWalletButton />
        </Empty>
      </Panel>
    );
  }
  if (!workspace.control.state) {
    return (
      <Panel label={label}>
        {workspace.control.error ? (
          <Empty title="Organization records are unavailable" detail={workspace.control.error}>
            <button type="button" onClick={workspace.control.refresh} className={BUTTON_GHOST}>
              Retry
            </button>
          </Empty>
        ) : (
          <Empty title="Loading organization records" />
        )}
      </Panel>
    );
  }
  if (!workspace.records) return <CreateOrganizationPanel workspace={workspace} />;
  return <>{children(workspace.records)}</>;
}

function CreateOrganizationPanel({ workspace, onClose }: { workspace: OrgWorkspace; onClose?: () => void }) {
  const runner = useRunner(workspace.control);
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await runner.run("create", "createOrganization", { name: name.trim() });
    if (!outcome.ok) return;
    const created = outcome.result as Organization;
    workspace.select(created.id);
    setName("");
    onClose?.();
  };
  return (
    <Panel label="Create organization">
      <PanelHead
        title="Create organization"
        tools={
          onClose ? (
            <button type="button" onClick={onClose} className={BUTTON_SMALL}>
              Cancel
            </button>
          ) : null
        }
      />
      <form onSubmit={submit} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-end">
        <label className="block min-w-0 flex-1">
          <span className="text-[11px] text-faint">Organization name</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            placeholder="Treasury desk"
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
        </label>
        <button
          type="submit"
          disabled={name.trim().length === 0 || runner.busy !== null || !workspace.writable}
          title={workspace.writable ? undefined : (workspace.writeReason ?? undefined)}
          className={BUTTON_PRIMARY}
        >
          <Plus size={13} aria-hidden="true" />
          {runner.busy ? "Waiting for signature..." : "Create organization"}
        </button>
      </form>
      <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
        The connected wallet becomes the first admin. Admins add members by wallet address and assign their roles; every
        change is signed by the acting member&apos;s wallet.
      </p>
      <ErrorLine error={runner.error} />
    </Panel>
  );
}

/* ---------------------------------------------------------------- organization */

export function OrganizationSection({ workspace }: { workspace: OrgWorkspace }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <OrgGate workspace={workspace} label="Organization">
        {(records) => (
          <>
            <OrganizationPanel workspace={workspace} records={records} onCreate={() => setCreating(true)} />
            {creating ? <CreateOrganizationPanel workspace={workspace} onClose={() => setCreating(false)} /> : null}
            <MembersPanel workspace={workspace} records={records} />
          </>
        )}
      </OrgGate>
    </div>
  );
}

function OrganizationPanel({ workspace, records, onCreate }: { workspace: OrgWorkspace; records: OrganizationRecords; onCreate: () => void }) {
  const { organization, members, policy } = records;
  const state = workspace.control.state;
  return (
    <Panel label="Organization">
      <PanelHead
        title="Organization"
        tools={
          <>
            {workspace.organizations.length > 1 ? (
              <label className="flex items-center gap-1.5 text-[11px] text-faint">
                <span className="sr-only">Organization</span>
                <select
                  value={organization.id}
                  onChange={(event) => workspace.select(event.target.value)}
                  className="focus-ring h-7 max-w-[180px] rounded-md border border-line bg-inset px-1.5 text-[11px] text-ink"
                >
                  {workspace.organizations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="button" onClick={onCreate} className={BUTTON_SMALL} disabled={!workspace.writable}>
              <Plus size={12} aria-hidden="true" />
              New
            </button>
          </>
        }
      />
      <div className="grid gap-x-6 px-3 py-2 md:grid-cols-2">
        <div>
          <Row label="Name" value={organization.name} />
          <Row label="Organization id" value={<span title={organization.id}>{shortHex(organization.id, 10, 6)}</span>} tone="dim" />
          <Row label="Created" value={`${stamp(organization.createdAt)} UTC`} tone="dim" />
        </div>
        <div>
          <Row label="Created by" value={<Member address={organization.createdBy} me={workspace.control.member} />} tone="dim" />
          <Row label="Active members" value={`${activeMembers(members).length} of ${members.length}`} />
          <Row label="Current policy" value={policy ? `v${policy.version}` : "None"} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2 text-[11px] text-faint">
        <ProvenanceChip kind="OBSERVED" title="Read from the connected wallet and the organization control service." />
        {workspace.me
          ? workspace.me.status === "active"
            ? `Connected wallet ${shortHex(workspace.me.memberId)} holds the ${ROLE_LABEL[workspace.me.role]} role in this organization on ${state?.networkLabel ?? "this network"}.`
            : `Connected wallet ${shortHex(workspace.me.memberId)} was revoked ${stamp(workspace.me.revokedAt)} UTC. History stays visible; it can no longer act for this organization.`
          : "The connected wallet is not a member of this organization."}
      </div>
    </Panel>
  );
}

function MembersPanel({ workspace, records }: { workspace: OrgWorkspace; records: OrganizationRecords }) {
  const runner = useRunner(workspace.control);
  const admin = workspace.role === "admin";
  const me = workspace.control.member;
  const members = [...records.members].sort(
    (a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || a.grantedAt.localeCompare(b.grantedAt),
  );
  const revoke = (member: OrganizationMember) =>
    runner.run(`revoke-${member.memberId}`, "revokeRole", { organizationId: records.organization.id, memberId: member.memberId });
  const revokeButton = (member: OrganizationMember) =>
    admin && member.status === "active" ? (
      <button
        type="button"
        onClick={() => revoke(member)}
        disabled={runner.busy !== null || !workspace.writable}
        className={BUTTON_SMALL}
        aria-label={`Revoke ${member.memberId}`}
      >
        {runner.busy === `revoke-${member.memberId}` ? "Signing..." : "Revoke"}
      </button>
    ) : null;
  return (
    <Panel label="Members" delay={40}>
      <PanelHead title="Members" tools={<span className="tnum font-mono text-[11px] text-faint">{`${members.length} ${members.length === 1 ? "record" : "records"}`}</span>} />
      <ul className="md:hidden">
        {members.map((member) => (
          <li key={member.memberId} className="flex items-start justify-between gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
            <span className="min-w-0">
              <span className={`tnum block truncate font-mono text-xs ${member.status === "active" ? "text-ink" : "text-faint line-through"}`}>
                <Member address={member.memberId} me={me} />
              </span>
              <span className="tnum block font-mono text-[11px] text-faint">{`granted ${stamp(member.grantedAt)}${member.revokedAt ? ` / revoked ${stamp(member.revokedAt)}` : ""}`}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-dim">{ROLE_LABEL[member.role]}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
                <StateDot tone={member.status === "active" ? "up" : "dim"} />
                {member.status === "active" ? "Active" : "Revoked"}
              </span>
              {revokeButton(member)}
            </span>
          </li>
        ))}
      </ul>
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="relative w-full min-w-[680px] border-collapse text-left">
          <caption className="sr-only">Organization members, roles, and grant history</caption>
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Member</th>
              <th className={TH}>Role</th>
              <th className={TH}>Status</th>
              <th className={TH}>Granted</th>
              <th className={TH}>Granted by</th>
              <th className={TH}>Revoked</th>
              {admin ? <th className={TH_NUM}>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.memberId} className="h-9 border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                <td className={`tnum px-3 font-mono text-xs ${member.status === "active" ? "text-ink" : "text-faint line-through"}`}>
                  <Member address={member.memberId} me={me} />
                </td>
                <td className="px-3 text-xs text-dim">{ROLE_LABEL[member.role]}</td>
                <td className="px-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                    <StateDot tone={member.status === "active" ? "up" : "dim"} />
                    {member.status === "active" ? "Active" : "Revoked"}
                  </span>
                </td>
                <td className="tnum px-3 font-mono text-xs whitespace-nowrap text-dim">{stamp(member.grantedAt)}</td>
                <td className="tnum px-3 font-mono text-xs text-faint" title={member.grantedBy}>{shortHex(member.grantedBy)}</td>
                <td className="tnum px-3 font-mono text-xs whitespace-nowrap text-faint">{stamp(member.revokedAt)}</td>
                {admin ? <td className="px-3 py-1 text-right">{revokeButton(member)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorLine error={runner.error} />
      {admin ? <GrantRoleForm workspace={workspace} records={records} /> : null}
    </Panel>
  );
}

function GrantRoleForm({ workspace, records }: { workspace: OrgWorkspace; records: OrganizationRecords }) {
  const runner = useRunner(workspace.control);
  const [address, setAddress] = useState("");
  const [role, setRole] = useState<OrganizationRole>("trader");
  const valid = isAddress(address.trim(), { strict: false });
  const existing = valid ? records.members.find((member) => member.memberId === address.trim().toLowerCase()) : undefined;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await runner.run("grant", "grantRole", { organizationId: records.organization.id, memberId: address.trim().toLowerCase(), role });
    if (outcome.ok) setAddress("");
  };
  return (
    <form onSubmit={submit} className="border-t border-line-soft px-3 py-3">
      <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end">
        <label className="block min-w-0">
          <span className="text-[11px] text-faint">Member wallet address</span>
          <input
            type="text"
            value={address}
            spellCheck={false}
            autoComplete="off"
            placeholder="0x..."
            onChange={(event) => setAddress(event.target.value)}
            className={`${FIELD} tnum font-mono`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-faint">Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as OrganizationRole)} className={FIELD}>
            {ORGANIZATION_ROLE_LIST.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!valid || runner.busy !== null || !workspace.writable} className={BUTTON_PRIMARY}>
          {runner.busy ? "Waiting for signature..." : existing ? "Change role" : "Add member"}
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-faint">
        {address.trim() !== "" && !valid
          ? "Enter a full wallet address."
          : existing
            ? `${shortHex(existing.memberId)} is ${existing.status === "active" ? `a ${ROLE_LABEL[existing.role].toLowerCase()}` : "revoked"}; granting replaces the role and reactivates the member.`
            : "Members act with their own wallets. Granting a role to an existing member replaces it."}
      </p>
      <ErrorLine error={runner.error} />
    </form>
  );
}

/* ---------------------------------------------------------------- subaccounts */

const ACCOUNT_TONE = { active: "up", suspended: "brand", closed: "dim" } as const;

export function SubaccountsSection({ workspace }: { workspace: OrgWorkspace }) {
  const snapshot = useGatewaySnapshot();
  const connected = snapshot.wallet.status === "CONNECTED";
  const account = snapshot.account;
  return (
    <div className="flex flex-col gap-1">
      <Panel label="Connected trading account">
        <PanelHead title="Trading account" tools={<ProvenanceChip kind="OBSERVED" title={`Read from the ${snapshot.environment.label} collateral vault.`} />} />
        <div className="grid gap-x-6 px-3 py-2 md:grid-cols-2">
          <div>
            <Row label="Label" value={account.label} />
            <Row label="Account id" value={connected ? <span title={account.id}>{shortHex(account.id, 10, 6)}</span> : "Not connected"} tone="dim" />
            <Row label="Risk domain" value={account.riskDomain} tone="dim" />
          </div>
          <div>
            <Row label="Collateral asset" value={account.collateralAsset} />
            <Row label="Posted" value={connected ? `${formatNumber(account.posted, 2)} ${account.collateralAsset}` : "-"} tone="dim" />
            <Row label="Available" value={connected ? `${formatNumber(account.available, 2)} ${account.collateralAsset}` : "-"} tone="dim" />
          </div>
        </div>
        {connected && workspace.records ? <RegisterAccount workspace={workspace} records={workspace.records} accountId={account.id} label={account.label} /> : null}
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          Each wallet holds one isolated trading account per risk domain in this environment. Switching subaccount
          changes collateral, positions, limits, and signing authority together.
        </p>
      </Panel>

      <OrgGate workspace={workspace} label="Organization subaccounts">
        {(records) => <OrgAccountsPanel workspace={workspace} records={records} />}
      </OrgGate>
    </div>
  );
}

function RegisterAccount({ workspace, records, accountId, label }: { workspace: OrgWorkspace; records: OrganizationRecords; accountId: string; label: string }) {
  const runner = useRunner(workspace.control);
  const [name, setName] = useState(label);
  const id = accountId.toLowerCase();
  const registered = records.accounts.find((item) => item.accountId === id);
  if (registered) {
    return (
      <div className="border-t border-line-soft px-3 py-2">
        <Row label="Organization subaccount" value={`${registered.label} / ${ACCOUNT_STATUS_LABEL[registered.status]} in ${records.organization.name}`} tone="dim" />
      </div>
    );
  }
  if (!roleCan(workspace.role, "register-accounts")) {
    return <p className="border-t border-line-soft px-3 py-2 text-[11px] text-faint">Your role in {records.organization.name} cannot register subaccounts.</p>;
  }
  const ready = /^0x[0-9a-f]{64}$/.test(id) && id !== EMPTY_ID;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await runner.run("register", "registerStrategyAccount", { organizationId: records.organization.id, accountId: id, label: name.trim(), riskDomainId: null });
  };
  return (
    <form onSubmit={submit} className="border-t border-line-soft px-3 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <label className="block min-w-0 flex-1">
          <span className="text-[11px] text-faint">{`Subaccount label in ${records.organization.name}`}</span>
          <input type="text" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className={FIELD} />
        </label>
        <button type="submit" disabled={!ready || name.trim().length === 0 || runner.busy !== null || !workspace.writable} className={BUTTON_PRIMARY}>
          {runner.busy ? "Waiting for signature..." : "Register as subaccount"}
        </button>
      </div>
      {!ready ? <p className="mt-2 text-[11px] text-faint">The trading account id is still loading from the collateral vault.</p> : null}
      <ErrorLine error={runner.error} />
    </form>
  );
}

function OrgAccountsPanel({ workspace, records }: { workspace: OrgWorkspace; records: OrganizationRecords }) {
  const runner = useRunner(workspace.control);
  const admin = workspace.role === "admin";
  const accounts = [...records.accounts].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  return (
    <Panel label="Organization subaccounts" delay={40}>
      <PanelHead title="Organization subaccounts" tools={<span className="tnum font-mono text-[11px] text-faint">{`${accounts.length} registered`}</span>} />
      {accounts.length === 0 ? (
        <Empty
          title="No subaccounts registered"
          detail="Register the connected trading account above. Policies can then scope approvals to it, and admins can suspend or close it."
        />
      ) : (
        <>
          <ul className="md:hidden">
            {accounts.map((item) => (
              <li key={item.accountId} className="flex items-start justify-between gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
                <span className="min-w-0">
                  <span className="block text-xs text-ink">{item.label}</span>
                  <span className="tnum block truncate font-mono text-[11px] text-faint">{`${shortHex(item.accountId)} / ${item.riskDomainId ? shortHex(item.riskDomainId) : "no domain"}`}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                    <StateDot tone={ACCOUNT_TONE[item.status]} />
                    {ACCOUNT_STATUS_LABEL[item.status]}
                  </span>
                  {admin ? <AccountActions account={item} runner={runner} writable={workspace.writable} /> : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="scroll-thin hidden overflow-x-auto md:block">
            <table className="relative w-full min-w-[680px] border-collapse text-left">
              <caption className="sr-only">Strategy accounts registered to the organization</caption>
              <thead>
                <tr className="border-b border-line">
                  <th className={TH}>Subaccount</th>
                  <th className={TH}>Account id</th>
                  <th className={TH}>Risk domain</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Registered</th>
                  <th className={TH}>By</th>
                  {admin ? <th className={TH_NUM}>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {accounts.map((item) => (
                  <tr key={item.accountId} className="h-9 border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                    <td className="px-3 text-xs text-ink">{item.label}</td>
                    <td className="tnum px-3 font-mono text-xs text-dim" title={item.accountId}>{shortHex(item.accountId)}</td>
                    <td className="tnum px-3 font-mono text-xs text-dim" title={item.riskDomainId ?? undefined}>{item.riskDomainId ? shortHex(item.riskDomainId) : "Unassigned"}</td>
                    <td className="px-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                        <StateDot tone={ACCOUNT_TONE[item.status]} />
                        {ACCOUNT_STATUS_LABEL[item.status]}
                      </span>
                    </td>
                    <td className="tnum px-3 font-mono text-xs whitespace-nowrap text-dim">{stamp(item.registeredAt)}</td>
                    <td className="tnum px-3 font-mono text-xs text-faint" title={item.registeredBy}>{shortHex(item.registeredBy)}</td>
                    {admin ? (
                      <td className="px-3 py-1 text-right">
                        <AccountActions account={item} runner={runner} writable={workspace.writable} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ErrorLine error={runner.error} />
    </Panel>
  );
}

function AccountActions({ account, runner, writable }: { account: StrategyAccount; runner: Runner; writable: boolean }) {
  const [confirmClose, setConfirmClose] = useState(false);
  if (account.status === "closed") return <span className="text-[11px] text-off">Final</span>;
  const key = `status-${account.accountId}`;
  const disabled = runner.busy !== null || !writable;
  const set = (status: StrategyAccount["status"]) =>
    runner.run(key, "setAccountStatus", { organizationId: account.organizationId, accountId: account.accountId, status });
  return (
    <span className="inline-flex justify-end gap-1">
      <button type="button" disabled={disabled} onClick={() => set(account.status === "active" ? "suspended" : "active")} className={BUTTON_SMALL}>
        {account.status === "active" ? "Suspend" : "Activate"}
      </button>
      {confirmClose ? (
        <button
          type="button"
          disabled={disabled}
          onClick={async () => {
            await set("closed");
            setConfirmClose(false);
          }}
          className={`${BUTTON_SMALL} border-down/40 text-down`}
        >
          Confirm close
        </button>
      ) : (
        <button type="button" disabled={disabled} onClick={() => setConfirmClose(true)} className={BUTTON_SMALL} title="Closing is final">
          Close
        </button>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- roles */

export function RolesSection({ workspace }: { workspace: OrgWorkspace }) {
  const active = workspace.records ? activeMembers(workspace.records.members) : [];
  const counts = Object.fromEntries(ORGANIZATION_ROLE_LIST.map((role) => [role, active.filter((member) => member.role === role).length]));
  return (
    <Panel label="Roles and permissions">
      <PanelHead title="Roles and permissions" tools={<Chip tone="neutral" title="Derived from the organization-control service's own authorization checks">Service rules</Chip>} />
      <p className="border-b border-line-soft px-3 py-1.5 text-[11px] text-faint md:hidden">Scroll sideways for every role.</p>
      <div className="scroll-thin overflow-x-auto">
        <table className="relative w-full min-w-[720px] border-collapse text-left">
          <caption className="sr-only">Which organization role can perform each action</caption>
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Capability</th>
              {ORGANIZATION_ROLE_LIST.map((role) => (
                <th key={role} className={`${TH_NUM} w-[92px] text-center ${workspace.role === role ? "text-ink" : ""}`}>
                  <span className="block text-center">{ROLE_LABEL[role]}</span>
                  <span className="tnum block text-center font-mono text-[10px] text-off">{workspace.role === role ? `${counts[role]} / you` : counts[role]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => (
              <tr key={capability.id} className="border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                <td className="px-3 py-2">
                  <span className="block text-xs text-ink">{capability.label}</span>
                  <span className="block text-[11px] text-faint">{capability.detail}</span>
                </td>
                {ORGANIZATION_ROLE_LIST.map((role) => {
                  const allowed = capability.roles === "ANY" || capability.roles.includes(role);
                  return (
                    <td key={role} className={`px-3 text-center ${workspace.role === role ? "bg-raised/40" : ""}`}>
                      {allowed ? (
                        <Check size={14} aria-label="Allowed" className="mx-auto text-up" />
                      ) : (
                        <Minus size={14} aria-label="Not allowed" className="mx-auto text-off" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
        Revoking a role stops new risk only. Settlement, terminal resolution, and collateral release follow committed
        state on the permissionless path, so a revoked member never strands a historical position.
      </p>
    </Panel>
  );
}

/* ---------------------------------------------------------------- approvals */

const PROPOSAL_TONE: Record<ApprovalStatus, "up" | "brand" | "down" | "dim"> = {
  draft: "dim",
  pending: "brand",
  approved: "up",
  rejected: "down",
  expired: "dim",
  executed: "up",
  canceled: "dim",
};

export function ApprovalsSection({ workspace }: { workspace: OrgWorkspace }) {
  return (
    <div className="flex flex-col gap-1">
      <OrgGate workspace={workspace} label="Approvals">
        {(records) => (
          <>
            <PolicyPanel workspace={workspace} records={records} />
            <ProposalsPanel workspace={workspace} records={records} />
          </>
        )}
      </OrgGate>
    </div>
  );
}

function scopeText(mode: "any" | "list", values: readonly string[], format: (value: string) => string = (value) => value): string {
  return mode === "any" ? "Any" : values.map(format).join(", ");
}

function PolicyPanel({ workspace, records }: { workspace: OrgWorkspace; records: OrganizationRecords }) {
  const [editing, setEditing] = useState(false);
  const policy = records.policy;
  const admin = workspace.role === "admin";
  const history = records.policies.filter((item) => item.supersededAt !== null);
  const accountLabel = (id: string) => records.accounts.find((account) => account.accountId === id)?.label ?? shortHex(id);
  return (
    <Panel label="Approval policy">
      <PanelHead
        title={policy ? `Approval policy v${policy.version}` : "Approval policy"}
        tools={
          <>
            {policy ? <span className="hidden text-[11px] text-faint sm:inline" title={policy.createdBy}>{`published ${stamp(policy.createdAt)} UTC by ${shortHex(policy.createdBy)}`}</span> : null}
            {admin ? (
              <button type="button" onClick={() => setEditing((value) => !value)} className={BUTTON_SMALL} disabled={!workspace.writable && !editing}>
                {editing ? "Close" : policy ? "New version" : "Publish policy"}
              </button>
            ) : null}
          </>
        }
      />
      {policy ? (
        <div className="grid gap-x-6 px-3 py-2 md:grid-cols-2">
          <div>
            <Row label="Required approvers" value={`${policy.constraints.requiredApprovers} ${ROLE_LABEL[policy.constraints.approverRole].toLowerCase()}`} />
            <Row
              label="Dual control at"
              value={policy.constraints.dualControlThreshold ? amount(policy.constraints.dualControlThreshold.amount, policy.constraints.dualControlThreshold.currency) : "Off"}
            />
            <Row label="Max notional" value={policy.constraints.maxNotional ? amount(policy.constraints.maxNotional.amount, policy.constraints.maxNotional.currency) : "None"} />
            <Row label="Min collateral" value={policy.constraints.minCollateral ? amount(policy.constraints.minCollateral.amount, policy.constraints.minCollateral.currency) : "None"} />
          </div>
          <div>
            <Row label="Subaccounts" value={scopeText(policy.constraints.accounts.mode, policy.constraints.accounts.values, accountLabel)} tone="dim" />
            <Row label="Routes" value={scopeText(policy.constraints.routes.mode, policy.constraints.routes.values)} tone="dim" />
            <Row label="Settlement" value={scopeText(policy.constraints.settlement.mode, policy.constraints.settlement.values)} tone="dim" />
            <Row
              label="Valid"
              value={
                policy.constraints.validFrom || policy.constraints.validUntil
                  ? `${policy.constraints.validFrom ? stamp(policy.constraints.validFrom).slice(0, 6) : "Now"} to ${policy.constraints.validUntil ? stamp(policy.constraints.validUntil).slice(0, 6) : "open"}`
                  : "Open"
              }
              tone="dim"
            />
          </div>
        </div>
      ) : (
        <p className="px-3 py-3 text-xs leading-relaxed text-faint">
          {admin
            ? "No policy published yet. Proposals are evaluated against the published policy, so publish one before traders route new risk for approval."
            : "No policy published yet. An admin publishes the policy that proposals are evaluated against."}
        </p>
      )}
      {editing && admin ? <PolicyForm key={policy?.version ?? 0} workspace={workspace} records={records} policy={policy} onDone={() => setEditing(false)} /> : null}
      {history.length > 0 ? (
        <p className="border-t border-line-soft px-3 py-2 text-[11px] text-faint">
          {history
            .map((item) => `v${item.version} superseded ${stamp(item.supersededAt)} UTC (max ${item.constraints.maxNotional ? amount(item.constraints.maxNotional.amount, item.constraints.maxNotional.currency) : "none"})`)
            .join(" / ")}
        </p>
      ) : null}
    </Panel>
  );
}

function dateOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function PolicyForm({ workspace, records, policy, onDone }: { workspace: OrgWorkspace; records: OrganizationRecords; policy: PolicyVersion | null; onDone: () => void }) {
  const runner = useRunner(workspace.control);
  const base = policy?.constraints ?? null;
  const [currency, setCurrency] = useState<string>(base?.maxNotional?.currency ?? base?.dualControlThreshold?.currency ?? "USDC");
  const [maxNotional, setMaxNotional] = useState(base?.maxNotional?.amount ?? "");
  const [dualControl, setDualControl] = useState(base?.dualControlThreshold?.amount ?? "");
  const [requiredApprovers, setRequiredApprovers] = useState(String(base?.requiredApprovers ?? 1));
  const [approverRole, setApproverRole] = useState<OrganizationRole>(base?.approverRole ?? "approver");
  const [validFrom, setValidFrom] = useState(dateOf(base?.validFrom ?? null));
  const [validUntil, setValidUntil] = useState(dateOf(base?.validUntil ?? null));

  const problems: string[] = [];
  if (maxNotional.trim() !== "" && (!AMOUNT_PATTERN.test(maxNotional.trim()) || Number(maxNotional) <= 0)) problems.push("Max notional must be a positive amount.");
  if (dualControl.trim() !== "" && (!AMOUNT_PATTERN.test(dualControl.trim()) || Number(dualControl) <= 0)) problems.push("Dual control threshold must be a positive amount.");
  if (validFrom && validUntil && validFrom >= validUntil) problems.push("The validity window must end after it starts.");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problems.length > 0) return;
    const constraints: PolicyConstraints = {
      accounts: base?.accounts ?? { mode: "any", values: [] },
      markets: base?.markets ?? { mode: "any", values: [] },
      riskDomains: base?.riskDomains ?? { mode: "any", values: [] },
      routes: base?.routes ?? { mode: "any", values: [] },
      settlement: base?.settlement ?? { mode: "any", values: [] },
      maxNotional: maxNotional.trim() ? { amount: maxNotional.trim(), currency } : null,
      minCollateral: base?.minCollateral ?? null,
      validFrom: validFrom ? `${validFrom}T00:00:00.000Z` : null,
      validUntil: validUntil ? `${validUntil}T23:59:59.000Z` : null,
      requiredApprovers: Number(requiredApprovers),
      approverRole,
      dualControlThreshold: dualControl.trim() ? { amount: dualControl.trim(), currency } : null,
    };
    const outcome = await runner.run("policy", "publishPolicy", { organizationId: records.organization.id, constraints });
    if (outcome.ok) onDone();
  };

  return (
    <form onSubmit={submit} className="border-t border-line-soft px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-[11px] text-faint">Max notional</span>
          <input type="text" inputMode="decimal" value={maxNotional} placeholder="No limit" onChange={(event) => setMaxNotional(event.target.value)} className={`${FIELD} tnum font-mono`} />
        </label>
        <label className="block">
          <span className="text-[11px] text-faint">Dual control at</span>
          <input type="text" inputMode="decimal" value={dualControl} placeholder="Off" onChange={(event) => setDualControl(event.target.value)} className={`${FIELD} tnum font-mono`} />
        </label>
        <label className="block">
          <span className="text-[11px] text-faint">Currency</span>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={FIELD}>
            {POLICY_CURRENCIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-faint">Approvers</span>
            <select value={requiredApprovers} onChange={(event) => setRequiredApprovers(event.target.value)} className={`${FIELD} tnum font-mono`}>
              {Array.from({ length: 8 }, (_, index) => String(index + 1)).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-faint">Role</span>
            <select value={approverRole} onChange={(event) => setApproverRole(event.target.value as OrganizationRole)} className={FIELD}>
              {APPROVER_ROLES.map((item) => (
                <option key={item} value={item}>
                  {ROLE_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] text-faint">Valid from (UTC)</span>
          <input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className={`${FIELD} font-mono [color-scheme:dark]`} />
        </label>
        <label className="block">
          <span className="text-[11px] text-faint">Valid until (UTC)</span>
          <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className={`${FIELD} font-mono [color-scheme:dark]`} />
        </label>
        <div className="flex items-end sm:col-span-2">
          <button type="submit" disabled={problems.length > 0 || runner.busy !== null || !workspace.writable} className={`${BUTTON_PRIMARY} w-full sm:w-auto`}>
            {runner.busy ? "Waiting for signature..." : `Publish v${(policy?.version ?? 0) + 1}`}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-faint">
        {problems.length > 0
          ? problems.join(" ")
          : "Notional at or above the dual-control threshold needs at least two approvers. Subaccount, market, route, and settlement scopes carry over from the current version."}
      </p>
      <ErrorLine error={runner.error} />
    </form>
  );
}

function ProposalsPanel({ workspace, records }: { workspace: OrgWorkspace; records: OrganizationRecords }) {
  const runner = useRunner(workspace.control);
  const now = useControlClock();
  const me = workspace.control.member;
  const accountLabel = (id: string) => records.accounts.find((account) => account.accountId === id)?.label ?? shortHex(id);
  return (
    <Panel label="Approval proposals" delay={40}>
      <PanelHead title="Proposals" tools={<span className="tnum font-mono text-[11px] text-faint">{`${records.proposals.length} ${records.proposals.length === 1 ? "proposal" : "proposals"}`}</span>} />
      {records.proposals.length === 0 ? (
        <Empty
          title="No proposals yet"
          detail="Traders and admins put new-risk actions up for approval under the published policy. Pending proposals wait here for the approver role."
        />
      ) : (
        <ul>
          {records.proposals.map((proposal) => (
            <ProposalRow key={proposal.id} proposal={proposal} workspace={workspace} runner={runner} now={now} me={me} accountLabel={accountLabel} />
          ))}
        </ul>
      )}
      <ErrorLine error={runner.error} />
      <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
        Notional at or above the dual-control threshold needs two approvers, and a proposer never counts toward their own
        approvals. Arbitrum One execution is refused by the write policy for new risk; terminal resolution needs no approval.
      </p>
    </Panel>
  );
}

function ProposalRow({
  proposal,
  workspace,
  runner,
  now,
  me,
  accountLabel,
}: {
  proposal: ApprovalProposal;
  workspace: OrgWorkspace;
  runner: Runner;
  now: number;
  me: string | null;
  accountLabel: (id: string) => string;
}) {
  const status = effectiveProposalStatus(proposal, now);
  const approvals = proposal.decisions.filter((decision) => decision.choice === "approve" && decision.approver !== proposal.createdBy).length;
  const own = me !== null && proposal.createdBy === me;
  const decided = proposal.decisions.some((decision) => decision.approver === me);
  const canDecide =
    status === "pending" && !own && !decided && workspace.role !== null && (workspace.role === proposal.approverRole || workspace.role === "admin");
  const canCancel = (own || workspace.role === "admin") && (status === "draft" || status === "pending" || status === "approved");
  const canSubmit = own && status === "draft";
  const canExpire = status === "expired" && proposal.status !== "expired" && workspace.role !== null;
  const disabled = runner.busy !== null || !workspace.writable;
  const busy = runner.busy?.endsWith(proposal.id) ? runner.busy.slice(0, runner.busy.indexOf(":")) : null;
  const run = (verb: string, action: OrganizationAction, params: Record<string, unknown>) => runner.run(`${verb}:${proposal.id}`, action, { proposalId: proposal.id, ...params });
  return (
    <li className="border-b border-line-soft px-3 py-2.5 last:border-b-0">
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_140px_120px_150px] lg:items-center lg:gap-3">
        <span className="min-w-0">
          <span className="block truncate text-xs text-ink">{`${proposal.actionKind.replace(/-/g, " ")} / ${accountLabel(proposal.accountId)}`}</span>
          <span className="tnum block truncate font-mono text-[11px] text-faint" title={proposal.createdBy}>
            {`${proposal.id} / ${proposal.routeClass} / ${proposal.settlementClass} / ${networkLabel(proposal.environment)} / by ${own ? "you" : shortHex(proposal.createdBy)}`}
          </span>
        </span>
        <span className="tnum font-mono text-xs text-ink lg:text-right">{amount(proposal.notional.amount, proposal.notional.currency)}</span>
        <span className="flex items-center gap-2 lg:justify-end">
          <span className="tnum font-mono text-[11px] text-dim">{`${approvals} / ${proposal.requiredApprovers}`}</span>
          <span className="flex gap-0.5" aria-hidden="true">
            {Array.from({ length: proposal.requiredApprovers }, (_, index) => (
              <span key={index} className={`h-1.5 w-3 rounded-full ${index < approvals ? "bg-up" : "bg-line-strong"}`} />
            ))}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 lg:justify-end">
          <span className="inline-flex items-center gap-1.5 text-xs text-dim">
            <StateDot tone={PROPOSAL_TONE[status]} />
            {APPROVAL_STATUS_LABEL[status]}
          </span>
          <span className="tnum font-mono text-[11px] text-faint">{`exp ${stamp(proposal.expiresAt).slice(7)}`}</span>
        </span>
      </div>
      {proposal.decisions.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5 border-l border-line pl-2.5">
          {proposal.decisions.map((decision) => (
            <li key={`${decision.approver}-${decision.decidedAt}`} className="tnum font-mono text-[11px] text-faint">
              <span className={decision.choice === "approve" ? "text-up" : "text-down"}>{decision.choice === "approve" ? "Approved" : "Rejected"}</span>
              {` by ${decision.approver === me ? "you" : shortHex(decision.approver)} (${decision.roleAtDecision}) ${stamp(decision.decidedAt)} UTC`}
              {decision.note ? <span className="font-sans text-dim">{` / ${decision.note}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {proposal.cancelReason ? <p className="mt-1 text-[11px] text-faint">{`Canceled: ${proposal.cancelReason}`}</p> : null}
      {canDecide || canCancel || canSubmit || canExpire ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {canSubmit ? (
            <button type="button" disabled={disabled} onClick={() => run("submit", "submitProposal", {})} className={BUTTON_SMALL}>
              {busy === "submit" ? "Signing..." : "Submit for approval"}
            </button>
          ) : null}
          {canDecide ? (
            <>
              <button type="button" disabled={disabled} onClick={() => run("approve", "decideOnProposal", { choice: "approve" })} className={`${BUTTON_SMALL} text-up`}>
                {busy === "approve" ? "Signing..." : "Approve"}
              </button>
              <button type="button" disabled={disabled} onClick={() => run("reject", "decideOnProposal", { choice: "reject" })} className={`${BUTTON_SMALL} text-down`}>
                {busy === "reject" ? "Signing..." : "Reject"}
              </button>
            </>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => run("cancel", "cancelProposal", { reason: own ? "Withdrawn by the proposer" : "Canceled by an admin" })}
              className={BUTTON_SMALL}
            >
              {busy === "cancel" ? "Signing..." : "Cancel"}
            </button>
          ) : null}
          {canExpire ? (
            <button type="button" disabled={disabled} onClick={() => run("expire", "expireProposal", {})} className={BUTTON_SMALL}>
              {busy === "expire" ? "Signing..." : "Record expiry"}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Pending proposals in the selected organization, for the Approvals badge. */
export function pendingApprovalCount(records: OrganizationRecords | null, now: number): number {
  return records ? records.proposals.filter((proposal) => effectiveProposalStatus(proposal, now) === "pending").length : 0;
}
