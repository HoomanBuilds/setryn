"use client";

import { useRef } from "react";
import { ArbitrumMark, UnderlyingMark, UsdcMark } from "@/components/landing/ui/Chain";
import PhaseTag from "@/components/landing/ui/PhaseTag";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/landing/gsap";
import { sound } from "@/lib/landing/sound";
import styles from "./Network.module.css";

const STATS = [
  { value: 16, decimals: 0, prefix: "", label: "Dated markets in the preview, across BTC, ETH, ARB, EUR/USD and gold" },
  { value: 8, decimals: 0, prefix: "", label: "Execution modes, from order books to sealed auctions" },
  { value: 9, decimals: 0, prefix: "", label: "Order policies, including IOC, FOK, GTD and post-only" },
];

/** The preview catalog's five families, each opening its terminal at a listed maturity. */
const MARKETS = [
  { underlying: "BTC", name: "Yield carry", href: "/trade/BTC-YC-24DEC26" },
  { underlying: "ETH", name: "Funding carry", href: "/trade/ETH-FC-24DEC26" },
  { underlying: "ARB", name: "Dated basis", href: "/trade/ARB-BS-26MAR27" },
  { underlying: "EUR/USD", name: "Non-deliverable forward", href: "/trade/EURUSD-FW-30DEC26" },
  { underlying: "XAU/USD", name: "Gold forward", href: "/trade/XAUUSD-FW-29JUN27" },
];

/** Where Setryn is on its way to Arbitrum One. Nothing here is a mainnet balance or volume. */
const ROLLOUT = [
  { network: "Local devnet", state: "Running now", current: true },
  { network: "Arbitrum Sepolia", state: "Public release candidate", current: false },
  { network: "Arbitrum One", state: "Capped launch", current: false },
];

/** Who works the market besides traders, each on one of hatom's planets. */
const ROLES = [
  { name: "Makers", job: "Firm quotes, capacity and RFQ responses", planet: "/hatom/planet_01.jpg" },
  { name: "Solvers", job: "Complete multi-leg packages at one price", planet: "/hatom/planet_02.jpg" },
  { name: "Keepers", job: "Auctions, fixing and settlement", planet: "/hatom/planet_03.jpg" },
  { name: "Auditors", job: "Rebuild any trade from its receipt", planet: "/hatom/planet_04.jpg" },
];

/** Every way an order can meet liquidity, all on one order and instrument model. */
const MODES = [
  { name: "Central limit order book", access: "Public" },
  { name: "Firm maker quotes", access: "Signed" },
  { name: "Multi-dealer RFQ", access: "Private" },
  { name: "Request for stream", access: "Private" },
  { name: "Sealed auction and batch", access: "Commit and reveal" },
  { name: "Solver competition", access: "Whole package" },
  { name: "Direct and implied liquidity", access: "Packages" },
  { name: "Netting and compression", access: "Portfolio" },
];

/**
 * Part 04 in aztec's register: a painted background on parallax, its serif
 * headline and counters, taceo's mint stat boxes, hatom's planets for the
 * roles that keep the market running, and the execution modes as a board.
 */
export default function Network() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          q(`.${styles.painting}`),
          { yPercent: -12 },
          { yPercent: 12, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } },
        );
      });

      // aztec's counters: count up once, when the stats scroll in.
      const counters = q<HTMLElement>("[data-value]");
      const zero = (element: HTMLElement) => (0).toFixed(Number(element.dataset.decimals));
      counters.forEach((element) => (element.textContent = zero(element)));
      ScrollTrigger.create({
        trigger: q(`.${styles.stats}`)[0],
        start: "top 85%",
        once: true,
        onEnter: () => {
          sound.play("DecodingUI");
          counters.forEach((element) => {
            const decimals = Number(element.dataset.decimals);
            const counter = { value: 0 };
            gsap.to(counter, {
              value: Number(element.dataset.value),
              duration: 2,
              ease: "power2.out",
              onUpdate: () => (element.textContent = counter.value.toFixed(decimals)),
            });
          });
        },
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="network" className={styles.network} data-theme="dark" data-phase="3">
      <div className={styles.backdrop} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.painting} src="/aztec/sandbox-bg.webp" alt="" />
      </div>

      <div className={`container ${styles.inner}`}>
        <PhaseTag phase={4}>Network</PhaseTag>
        <h2 className={styles.title} data-reveal>
          How the market runs
        </h2>

        <div className={styles.stats}>
          {STATS.map(({ value, decimals, prefix, label }) => (
            <div key={label} className={styles.stat}>
              <strong>
                {prefix}
                <span data-value={value} data-decimals={decimals}>
                  {value.toFixed(decimals)}
                </span>
              </strong>
              <span className="label">{label}</span>
            </div>
          ))}
        </div>

        {/* The chain and the collateral: Arbitrum One and native USDC, then the markets that settle there */}
        <div className={styles.chain} data-chain-block>
          <div className={styles.chainLead} data-reveal>
            <span className={styles.chainMark}>
              <ArbitrumMark size={120} />
            </span>
            <div className={styles.chainCopy}>
              <p className="label">Settlement layer</p>
              <h3 className={styles.chainTitle}>Built for Arbitrum One</h3>
              <p className={styles.chainBody}>
                Every position clears and settles on Arbitrum One against native USDC, issued by Circle rather than bridged.
                Fixings, payouts and receipts are onchain events that anyone can replay.
              </p>
              <ul className={styles.chainFacts}>
                <li>
                  <ArbitrumMark size={18} />
                  Arbitrum One
                </li>
                <li>
                  <UsdcMark size={18} />
                  Native USDC collateral
                </li>
                <li>Cash-settled at a published fixing</li>
              </ul>
            </div>
          </div>

          <div className={styles.chainSide} data-reveal>
            <p className="label">Markets in the preview</p>
            <ul className={styles.markets}>
              {MARKETS.map(({ underlying, name, href }) => (
                <li key={underlying}>
                  <a href={href} className={styles.market} data-sfx="ui">
                    <UnderlyingMark underlying={underlying} size={22} />
                    <strong>{underlying}</strong>
                    <span>{name}</span>
                    <span className={styles.marketArrow} aria-hidden="true">
                      →
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <ol className={styles.rollout} aria-label="Rollout">
              {ROLLOUT.map(({ network, state, current }) => (
                <li key={network} data-current={current || undefined}>
                  <span className="label">{state}</span>
                  <strong>{network}</strong>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className={styles.lower}>
          <ul className={styles.clusters} data-sound-cue="planetReveal">
            {ROLES.map(({ name, job, planet }) => (
              <li key={name} className={styles.cluster} data-reveal>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={planet}
                  alt=""
                  className={styles.planet}
                  data-cursor="Listen"
                  onPointerEnter={() => sound.chime()}
                />
                <span className={styles.clusterName}>{name}</span>
                <span className={styles.clusterMeta}>{job}</span>
              </li>
            ))}
          </ul>

          <div className={styles.feedPanel} data-reveal>
            <div className={styles.feedHead}>
              <span className="label">Execution modes</span>
              <span className={styles.live}>One order model</span>
            </div>
            <ol className={`mono ${styles.feed}`}>
              {MODES.map(({ name, access }, index) => (
                <li key={name}>
                  <span>{index + 1}</span>
                  <span className={styles.hash}>{name}</span>
                  <span>{access}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
