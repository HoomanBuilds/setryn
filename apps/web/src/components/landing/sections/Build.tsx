"use client";

import { useRef } from "react";
import { Arrow } from "@/components/landing/ui/Button";
import { Pins } from "@/components/landing/ui/Corners";
import PhaseTag from "@/components/landing/ui/PhaseTag";
import { APP_LINKS } from "@/lib/landing/app-links";
import { gsap, useGSAP } from "@/lib/landing/gsap";
import styles from "./Build.module.css";

const VERTICALS = [
  {
    name: "Protect",
    title: "Hedge a future cash flow",
    body: "Start from a receivable, a payable, inventory, debt or a token unlock. Choose the outcome you want and Setryn builds the instrument that gives it.",
    points: ["Budget-rate protection", "Hedge coverage", "Cash-flow calendar"],
    image: "/dymension/liquidity-illustration.png",
    href: APP_LINKS.protect,
    cta: "Open Protect",
  },
  {
    name: "Trade",
    title: "Trade expiries, curves and packages",
    body: "A professional terminal for books, curves, volatility, options and multi-leg strategies, with margin worked out across the whole portfolio.",
    points: ["Order book and RFQs", "Strategy builder", "Portfolio margin"],
    image: "/dymension/autonomy-illustration.png",
    href: APP_LINKS.trade,
    cta: "Open the terminal",
  },
  {
    name: "Make markets",
    title: "Quote surfaces, not single trades",
    body: "Makers publish firm quotes with explicit capacity, answer private RFQs, and manage inventory, Greeks and limits from one cockpit.",
    points: ["Quote surfaces", "RFQ queue", "Kill switches"],
    image: "/dymension/performance-illustration.png",
    href: APP_LINKS.maker,
    cta: "Open the maker cockpit",
  },
];

/** A position's life, bottom to top: dymension's discs stacking as it moves towards settlement. */
const DISCS = [
  { image: "/dymension/rollapp6.png", label: "Receipt", width: 0.39 },
  { image: "/dymension/rollapp5.png", label: "Settle", width: 0.62 },
  { image: "/dymension/rollapp4.png", label: "Fix", width: 0.78 },
  { image: "/dymension/rollapp1.png", label: "Roll", width: 0.88 },
  { image: "/dymension/rollapp3.png", label: "Adjust", width: 0.96 },
  { image: "/dymension/rollapp2.png", label: "Enter", width: 1 },
];

const ROLLOUT_STEPS = [
  {
    title: "Enter and adjust",
    body: "Add to, reduce, close, transfer or split a position. Each action shows collateral and risk before and after you sign.",
  },
  {
    title: "Roll or exercise",
    body: "Move to a new expiry or exercise an option, with the cost shown before you commit.",
  },
  {
    title: "Fix and settle",
    body: "At expiry the position fixes from its published rules and pays out in USDC. Anyone can complete settlement, even if an operator goes offline.",
  },
];

/**
 * Part 05 in dymension's warm palette: taceo's three-column layout with its
 * connector lines and dymension's framed illustrations for the three ways in,
 * then dymension's rollapp discs stacking into a position's lifecycle as you
 * scroll.
 */
export default function Build() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        // taceo's connector lines draw down from the heading to each card.
        gsap.from(q(`.${styles.connector} span`), {
          scaleY: 0,
          duration: 1.2,
          ease: "power3.inOut",
          stagger: 0.1,
          scrollTrigger: { trigger: q(`.${styles.connector}`)[0], start: "top 80%" },
        });
        gsap.from(q(`.${styles.vertical}`), {
          y: 60,
          opacity: 0,
          duration: 1,
          ease: "power3.out",
          stagger: 0.12,
          scrollTrigger: { trigger: q(`.${styles.verticals}`)[0], start: "top 85%" },
        });
      });

      // Desktop: pin the rollout and fan the discs out, one step at a time.
      media.add("(min-width: 901px) and (prefers-reduced-motion: no-preference)", () => {
        const discs = q<HTMLElement>(`.${styles.disc}`);
        const steps = q<HTMLElement>(`.${styles.rolloutStep}`);
        const spread = (index: number) => (index - (discs.length - 1)) * 72;
        gsap.set(discs, { y: (index) => (discs.length - 1 - index) * -10 });
        const timeline = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: {
            trigger: q(`.${styles.rollout}`)[0],
            start: "top top",
            end: "+=160%",
            pin: true,
            scrub: 0.8,
            onUpdate: (self) => {
              const current = Math.min(steps.length - 1, Math.floor(self.progress * steps.length));
              steps.forEach((step, index) => step.toggleAttribute("data-active", index === current));
            },
          },
        });
        timeline
          .to(discs, { y: (index) => spread(index), duration: 1, stagger: 0.04 })
          .to(q(`.${styles.discLabel}`), { opacity: 1, x: 0, duration: 0.5, stagger: 0.06 }, 0.4)
          // Tilt the artwork only, so the labels keep their even spacing.
          .to(q(`.${styles.disc} img`), { rotation: (index) => (index % 2 ? 3 : -3), duration: 0.6 }, 1);
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="build" className={styles.build} data-theme="warm" data-phase="4">
      <div className="container">
        <header className={styles.head}>
          <PhaseTag phase={5}>Products</PhaseTag>
          <h2 className={styles.title} data-reveal>
            Protect, trade or make markets
          </h2>
        </header>

        <div className={styles.connector} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className={styles.verticals}>
          {VERTICALS.map(({ name, title, body, points, image, href, cta }, index) => (
            <article key={name} className={styles.vertical}>
              <Pins />
              <div className={styles.verticalHead}>
                <span className="label">{name}</span>
                <span className="mono">0{index + 1}</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.illustration} src={image} alt="" />
              <h3>{title}</h3>
              <p>{body}</p>
              <ul>
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <a href={href} className={styles.verticalLink} data-sfx="ui">
                <span>{cta}</span>
                <Arrow />
              </a>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.rollout} data-sound-cue="griffinArmor">
        <div className={`container ${styles.rolloutInner}`}>
          <div className={styles.rolloutCopy}>
            <p className="label">Position lifecycle</p>
            <h3 className={styles.rolloutTitle} data-reveal>
              Managed from entry to settlement
            </h3>
            <ol className={styles.rolloutSteps}>
              {ROLLOUT_STEPS.map(({ title, body }, index) => (
                <li key={title} className={styles.rolloutStep} data-active={index === 0 || undefined}>
                  <span className="mono">0{index + 1}</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className={styles.tower} aria-hidden="true">
            {/* eslint-disable @next/next/no-img-element */}
            {DISCS.map(({ image, label, width }, index) => (
              <div key={label} className={styles.disc} style={{ width: `${width * 100}%`, zIndex: DISCS.length - index, ["--index" as string]: index }}>
                <img src={image} alt="" />
                <span className={`label ${styles.discLabel}`}>{label}</span>
              </div>
            ))}
            {/* eslint-enable @next/next/no-img-element */}
          </div>
        </div>
      </div>
    </section>
  );
}
