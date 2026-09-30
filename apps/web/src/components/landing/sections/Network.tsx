"use client";

import { useRef } from "react";
import PhaseTag from "@/components/landing/ui/PhaseTag";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/landing/gsap";
import { sound } from "@/lib/landing/sound";
import styles from "./Network.module.css";

const STATS = [
  { value: 16, decimals: 0, prefix: "", label: "Dated markets across BTC, ETH, ARB, EUR/USD and gold" },
  { value: 8, decimals: 0, prefix: "", label: "Execution modes, from order books to sealed auctions" },
  { value: 9, decimals: 0, prefix: "", label: "Order policies, including IOC, FOK, GTD and post-only" },
];

/** Who works the market besides traders, each on one of hatom's planets. */
const ROLES = [
  { name: "Makers", job: "Firm quotes, capacity and RFQ responses", planet: "/hatom/planet_01.jpg" },
  { name: "Solvers", job: "Complete multi-leg packages at one price", planet: "/hatom/planet_02.jpg" },
  { name: "Keepers", job: "Auctions, fixing and settlement", planet: "/hatom/planet_03.jpg" },
  { name: "Auditors", job: "Rebuild any trade from its receipt", planet: "/hatom/planet_04.jpg" },
];

/**
 * Part 04 in aztec's register: a painted background on parallax, its serif
 * headline and counters, taceo's mint stat boxes, hatom's planets for the
 * roles that keep the market running.
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
        </div>
      </div>
    </section>
  );
}
