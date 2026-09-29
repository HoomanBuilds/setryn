"use client";

import { Check, Minus } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { ProvenanceChip, StateDot } from "@/components/home/kit";
import { Chip, Panel, PanelHead, Row, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import {
  APPROVAL_STATUS_LABEL,
  CAPABILITIES,
  ORGANIZATION_CONTROL_FIXTURE as CONTROL,
  ORGANIZATION_SCHEMA,
  ROLE_LABEL,
  activeMembers,
  shortHex,
  type ApprovalStatus,
  type OrganizationRole,
} from "@/lib/settings/organization";
import { formatNumber } from "@/lib/terminal/format";

const ROLES: OrganizationRole[] = ["admin", "trader", "approver", "accountant", "viewer"];

function stamp(iso: string | null): string {
  if (!iso) return "-";
  return `${iso.slice(8, 10)} ${new Date(iso).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${iso.slice(11, 16)}`;
}

function amount(value: string, currency: string): string {
  return `${formatNumber(Number(value), 0)} ${currency}`;
}

export function FixtureNote() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-[11px] leading-relaxed text-faint">
      <ProvenanceChip kind="RECORDED_FIXTURE" title="Records typed from the organization-control service; this platform does not call the service yet." />
      <span className="tnum font-mono text-dim">{ORGANIZATION_SCHEMA}</span>
      <span className="min-w-0">
        {`Read-only. Organization, member, subaccount, policy, and approval records follow the organization-control service's schema, captured ${stamp(CONTROL.generatedAt)} UTC. Changes are made through the service, not from this page.`}
      </span>
    </div>
  );
}

export function OrganizationSection() {
  const snapshot = useGatewaySnapshot();
  const organization = CONTROL.organizations[0];
  const policy = CONTROL.policies.find((item) => item.supersededAt === null);
  const members = CONTROL.members;
  return (
    <div className="flex flex-col gap-1">
      <Panel label="Organization">
        <PanelHead title="Organization" tools={<ProvenanceChip kind="RECORDED_FIXTURE" />} />
        <div className="grid gap-x-6 px-3 py-2 md:grid-cols-2">
          <div>
            <Row label="Name" value={organization?.name ?? "-"} />
            <Row label="Organization id" value={<span title={organization?.id}>{shortHex(organization?.id ?? "", 10, 6)}</span>} tone="dim" />
            <Row label="Created" value={`${stamp(organization?.createdAt ?? null)} UTC`} tone="dim" />
          </div>
          <div>
            <Row label="Created by" value={organization?.createdBy ?? "-"} tone="dim" />
            <Row label="Active members" value={`${activeMembers(members).length} of ${members.length}`} />
            <Row label="Current policy" value={policy ? `v${policy.version}` : "None"} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2 text-[11px] text-faint">
          <ProvenanceChip kind="OBSERVED" title="Read from the connected wallet." />
          {snapshot.wallet.status === "CONNECTED" && snapshot.wallet.address
            ? `Connected wallet ${shortHex(snapshot.wallet.address)} is not bound to a member of this organization in ${snapshot.environment.label}. It trades as a personal account.`
            : "No wallet connected. Connect one to see which workspace and signing authority it holds."}
        </div>
      </Panel>

      <Panel label="Members" delay={40}>
        <PanelHead title="Members" tools={<span className="tnum font-mono text-[11px] text-faint">{`${members.length} records`}</span>} />
        <ul className="md:hidden">
          {members.map((member) => (
            <li key={member.memberId} className="flex items-start justify-between gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
              <span className="min-w-0">
                <span className={`tnum block truncate font-mono text-xs ${member.status === "active" ? "text-ink" : "text-faint line-through"}`}>{member.memberId}</span>
                <span className="tnum block font-mono text-[11px] text-faint">{`granted ${stamp(member.grantedAt)}${member.revokedAt ? ` / revoked ${stamp(member.revokedAt)}` : ""}`}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-xs text-dim">{ROLE_LABEL[member.role]}</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
                  <StateDot tone={member.status === "active" ? "up" : "dim"} />
                  {member.status === "active" ? "Active" : "Revoked"}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="scroll-thin hidden overflow-x-auto md:block">
          <table className="relative w-full min-w-[620px] border-collapse text-left">
            <caption className="sr-only">Organization members, roles, and grant history</caption>
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Member</th>
                <th className={TH}>Role</th>
                <th className={TH}>Status</th>
                <th className={TH}>Granted</th>
                <th className={TH}>Granted by</th>
                <th className={TH}>Revoked</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.memberId} className="h-9 border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                  <td className={`tnum px-3 font-mono text-xs ${member.status === "active" ? "text-ink" : "text-faint line-through"}`}>{member.memberId}</td>
                  <td className="px-3 text-xs text-dim">{ROLE_LABEL[member.role]}</td>
                  <td className="px-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                      <StateDot tone={member.status === "active" ? "up" : "dim"} />
                      {member.status === "active" ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td className="tnum px-3 font-mono text-xs whitespace-nowrap text-dim">{stamp(member.grantedAt)}</td>
                  <td className="tnum px-3 font-mono text-xs text-faint">{member.grantedBy}</td>
                  <td className="tnum px-3 font-mono text-xs whitespace-nowrap text-faint">{stamp(member.revokedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

const ACCOUNT_TONE = { active: "up", suspended: "brand", closed: "dim" } as const;

export function SubaccountsSection() {
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
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          Each wallet holds one isolated trading account per risk domain in this environment. Switching subaccount
          changes collateral, positions, limits, and signing authority together.
        </p>
      </Panel>

      <Panel label="Organization subaccounts" delay={40}>
        <PanelHead title="Organization subaccounts" tools={<ProvenanceChip kind="RECORDED_FIXTURE" />} />
        <ul className="md:hidden">
          {CONTROL.accounts.map((item) => (
            <li key={item.accountId} className="flex items-start justify-between gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
              <span className="min-w-0">
                <span className="block text-xs text-ink">{item.label}</span>
                <span className="tnum block truncate font-mono text-[11px] text-faint">{`${shortHex(item.accountId)} / ${item.riskDomainId ? shortHex(item.riskDomainId) : "no domain"}`}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-dim">
                <StateDot tone={ACCOUNT_TONE[item.status]} />
                {item.status[0].toUpperCase() + item.status.slice(1)}
              </span>
            </li>
          ))}
        </ul>
        <div className="scroll-thin hidden overflow-x-auto md:block">
          <table className="relative w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Strategy accounts registered to the organization</caption>
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Subaccount</th>
                <th className={TH}>Account id</th>
                <th className={TH}>Risk domain</th>
                <th className={TH}>Status</th>
                <th className={TH}>Registered</th>
                <th className={TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {CONTROL.accounts.map((item) => (
                <tr key={item.accountId} className="h-9 border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                  <td className="px-3 text-xs text-ink">{item.label}</td>
                  <td className="tnum px-3 font-mono text-xs text-dim" title={item.accountId}>{shortHex(item.accountId)}</td>
                  <td className="tnum px-3 font-mono text-xs text-dim" title={item.riskDomainId ?? undefined}>{item.riskDomainId ? shortHex(item.riskDomainId) : "Unassigned"}</td>
                  <td className="px-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                      <StateDot tone={ACCOUNT_TONE[item.status]} />
                      {item.status[0].toUpperCase() + item.status.slice(1)}
                    </span>
                  </td>
                  <td className="tnum px-3 font-mono text-xs whitespace-nowrap text-dim">{stamp(item.registeredAt)}</td>
                  <td className="tnum px-3 font-mono text-xs text-faint">{item.registeredBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function RolesSection() {
  const counts = Object.fromEntries(ROLES.map((role) => [role, activeMembers(CONTROL.members).filter((member) => member.role === role).length]));
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
              {ROLES.map((role) => (
                <th key={role} className={`${TH_NUM} w-[92px] text-center`}>
                  <span className="block text-center">{ROLE_LABEL[role]}</span>
                  <span className="tnum block text-center font-mono text-[10px] text-off">{counts[role]}</span>
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
                {ROLES.map((role) => {
                  const allowed = capability.roles === "ANY" || capability.roles.includes(role);
                  return (
                    <td key={role} className="px-3 text-center">
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

const PROPOSAL_TONE: Record<ApprovalStatus, "up" | "brand" | "down" | "dim"> = {
  draft: "dim",
  pending: "brand",
  approved: "up",
  rejected: "down",
  expired: "dim",
  executed: "up",
  canceled: "dim",
};

export function ApprovalsSection() {
  const policy = CONTROL.policies.find((item) => item.supersededAt === null);
  const history = CONTROL.policies.filter((item) => item.supersededAt !== null);
  const accountLabel = (id: string) => CONTROL.accounts.find((account) => account.accountId === id)?.label ?? shortHex(id);
  const scope = (mode: "any" | "list", values: readonly string[], format: (value: string) => string = (value) => value) =>
    mode === "any" ? "Any" : values.map(format).join(", ");
  return (
    <div className="flex flex-col gap-1">
      {policy ? (
        <Panel label="Approval policy">
          <PanelHead
            title={`Approval policy v${policy.version}`}
            tools={<span className="hidden text-[11px] text-faint sm:inline">{`published ${stamp(policy.createdAt)} UTC by ${policy.createdBy}`}</span>}
          />
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
              <Row label="Subaccounts" value={scope(policy.constraints.accounts.mode, policy.constraints.accounts.values, accountLabel)} tone="dim" />
              <Row label="Routes" value={scope(policy.constraints.routes.mode, policy.constraints.routes.values)} tone="dim" />
              <Row label="Settlement" value={scope(policy.constraints.settlement.mode, policy.constraints.settlement.values)} tone="dim" />
              <Row
                label="Valid"
                value={`${stamp(policy.constraints.validFrom).slice(0, 6)} to ${stamp(policy.constraints.validUntil).slice(0, 6)}`}
                tone="dim"
              />
            </div>
          </div>
          {history.length > 0 ? (
            <p className="border-t border-line-soft px-3 py-2 text-[11px] text-faint">
              {history
                .map((item) => `v${item.version} superseded ${stamp(item.supersededAt)} UTC (max ${item.constraints.maxNotional ? amount(item.constraints.maxNotional.amount, item.constraints.maxNotional.currency) : "none"})`)
                .join(" / ")}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel label="Approval proposals" delay={40}>
        <PanelHead title="Proposals" tools={<ProvenanceChip kind="RECORDED_FIXTURE" />} />
        <ul>
          {CONTROL.proposals.map((proposal) => {
            const approvals = proposal.decisions.filter((decision) => decision.choice === "approve").length;
            return (
              <li key={proposal.id} className="border-b border-line-soft px-3 py-2.5 last:border-b-0">
                <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_140px_120px_150px] lg:items-center lg:gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-ink">
                      {`${proposal.actionKind.replace(/-/g, " ")} / ${accountLabel(proposal.accountId)}`}
                    </span>
                    <span className="tnum block truncate font-mono text-[11px] text-faint">
                      {`${proposal.id} / ${proposal.routeClass} / ${proposal.settlementClass} / ${proposal.environment}`}
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
                      <StateDot tone={PROPOSAL_TONE[proposal.status]} />
                      {APPROVAL_STATUS_LABEL[proposal.status]}
                    </span>
                    <span className="tnum font-mono text-[11px] text-faint">{`exp ${stamp(proposal.expiresAt).slice(7)}`}</span>
                  </span>
                </div>
                {proposal.decisions.length > 0 ? (
                  <ul className="mt-1.5 flex flex-col gap-0.5 border-l border-line pl-2.5">
                    {proposal.decisions.map((decision) => (
                      <li key={`${decision.approver}-${decision.decidedAt}`} className="tnum font-mono text-[11px] text-faint">
                        <span className={decision.choice === "approve" ? "text-up" : "text-down"}>{decision.choice === "approve" ? "Approved" : "Rejected"}</span>
                        {` by ${decision.approver} (${decision.roleAtDecision}) ${stamp(decision.decidedAt)} UTC`}
                        {decision.note ? <span className="font-sans text-dim">{` / ${decision.note}`}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          Notional at or above the dual-control threshold needs two approvers. Arbitrum One execution is refused by the
          write policy for new risk; terminal resolution needs no approval.
        </p>
      </Panel>
    </div>
  );
}
