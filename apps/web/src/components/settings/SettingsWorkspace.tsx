"use client";

import { useSyncExternalStore } from "react";
import { Building2, KeyRound, ListChecks, Network, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { PageFrame, PageHeader, WalletBadge } from "@/components/home/kit";
import { Chip, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { ORGANIZATION_CONTROL_FIXTURE } from "@/lib/settings/organization";
import { ApprovalsSection, FixtureNote, OrganizationSection, RolesSection, SubaccountsSection } from "./OrgSections";
import { PrivacySection, SecuritySection, TradingSection } from "./PreferenceSections";

const SECTIONS = [
  { id: "organization", label: "Organization", icon: Building2, group: "Organization" },
  { id: "subaccounts", label: "Subaccounts", icon: Network, group: "Organization" },
  { id: "roles", label: "Roles", icon: Users, group: "Organization" },
  { id: "approvals", label: "Approvals", icon: ListChecks, group: "Organization" },
  { id: "trading", label: "Trading", icon: SlidersHorizontal, group: "Preferences" },
  { id: "privacy", label: "Privacy", icon: ShieldCheck, group: "Preferences" },
  { id: "security", label: "Security", icon: KeyRound, group: "Preferences" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];
const ORG_SECTIONS: readonly SectionId[] = ["organization", "subaccounts", "roles", "approvals"];

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): string {
  return window.location.hash.slice(1);
}

/** Keeps the active section visible when the nav is a horizontal strip on narrow screens. */
function scrollIntoRow(node: HTMLAnchorElement | null) {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** The section lives in the URL hash, so `/settings#approvals` deep-links from Home and the command search. */
function useSection(): SectionId {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  return SECTIONS.some((section) => section.id === hash) ? (hash as SectionId) : "organization";
}

export function SettingsWorkspace() {
  const snapshot = useGatewaySnapshot();
  const section = useSection();
  const pending = ORGANIZATION_CONTROL_FIXTURE.proposals.filter((proposal) => proposal.status === "pending").length;
  const organization = ORGANIZATION_CONTROL_FIXTURE.organizations[0];

  return (
    <PageFrame label="Settings">
      <PageHeader
        title="Settings"
        subtitle="Organizations, subaccounts, roles, approvals, privacy, and security"
        chips={
          <>
            <Chip tone="neutral">{organization?.name ?? "Personal"}</Chip>
            <Chip tone="neutral" title={`Chain ${snapshot.environment.chainId}`}>{snapshot.environment.label}</Chip>
          </>
        }
        actions={<WalletBadge />}
      />

      <div className="grid min-w-0 gap-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className={`${deskMotion.rise} min-w-0 rounded-lg border border-line bg-panel lg:sticky lg:top-0 lg:self-start`}>
          <ul className="no-scrollbar flex overflow-x-auto p-1 lg:flex-col lg:overflow-visible lg:p-1.5">
            {SECTIONS.map((item, index) => {
              const active = item.id === section;
              const Icon = item.icon;
              const heading = index === 0 || SECTIONS[index - 1].group !== item.group;
              return (
                <li key={item.id} className="shrink-0">
                  {heading ? <span className="hidden px-2.5 pt-2.5 pb-1 text-[10.5px] tracking-[0.04em] text-off uppercase lg:block">{item.group}</span> : null}
                  <a
                    ref={active ? scrollIntoRow : undefined}
                    href={`#${item.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring relative flex h-11 items-center gap-2 rounded-md px-3 text-[13px] whitespace-nowrap transition-colors duration-150 lg:h-8 lg:px-2.5 ${
                      active ? "bg-raised text-ink" : "text-faint hover:bg-raised/60 hover:text-dim"
                    }`}
                  >
                    <Icon size={14} aria-hidden="true" className={active ? "text-brand" : "text-off"} />
                    {item.label}
                    {item.id === "approvals" && pending > 0 ? (
                      <span className="tnum ml-auto rounded-[3px] bg-brand-soft px-1 font-mono text-[10px] leading-4 text-brand">{pending}</span>
                    ) : null}
                    {active ? <span aria-hidden="true" className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-brand lg:block" /> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <TabBody key={section} idBase="settings" className="flex min-w-0 flex-col gap-1 2xl:max-w-[1240px]">
          {ORG_SECTIONS.includes(section) ? <FixtureNote /> : null}
          {section === "organization" ? <OrganizationSection /> : null}
          {section === "subaccounts" ? <SubaccountsSection /> : null}
          {section === "roles" ? <RolesSection /> : null}
          {section === "approvals" ? <ApprovalsSection /> : null}
          {section === "trading" ? <TradingSection /> : null}
          {section === "privacy" ? <PrivacySection /> : null}
          {section === "security" ? <SecuritySection /> : null}
        </TabBody>
      </div>
    </PageFrame>
  );
}
