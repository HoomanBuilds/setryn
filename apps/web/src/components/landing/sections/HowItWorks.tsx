"use client";

import { useRef, useState } from "react";
import { Diamonds } from "@/components/landing/ui/Corners";
import PhaseTag from "@/components/landing/ui/PhaseTag";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/landing/gsap";
import styles from "./HowItWorks.module.css";

const STEPS = [
  {
    name: "Request",
    title: "Describe the exposure",
    body: "Enter what is at risk, which way, how much and by when: a receivable, a payable, a token unlock or a treasury sale. Send it to the public book, to makers you invite, or to both.",
    icon: "/zkemail/DKIMIcon.png",
    who: "The public sees",
    sees: "an encrypted request",
  },
  {
    name: "Compare",
    title: "Compare firm quotes side by side",
    body: "Book depth, maker quotes and RFQ responses appear together with their all-in price, fees, size, expiry and settlement terms. Indicative prices are labelled and never counted as firm depth.",
    icon: "/zkemail/RegexIcon.png",
    who: "Makers quote",
    sees: "3 firm quotes, best 4,232.10",
  },
  {
    name: "Settle",
    title: "Clear it, then settle with a receipt",
    body: "Your signed order clears against USDC and becomes a position you can add to, reduce, roll or close. At expiry it fixes by published rules, pays out in USDC and leaves a receipt anyone can check.",
    icon: "/zkemail/ZKCircuitsIcon.webp",
    who: "Anyone can check",
    sees: "the fixing, the payout and the fees",
  },
];
const USE_CASES = [
  {
    title: "Token unlocks",
    body: "A team with tokens unlocking in March sells them forward now, so it knows what the unlock is worth in USDC.",
    image: "/zkemail/Recovery.png",
  },
  {
    title: "Treasury payables",
    body: "A DAO that pays contributors in euros fixes the EUR/USD rate for each payroll date in advance, settled in USDC.",
    image: "/zkemail/WhistleblowLogo.png",
  },
];
const STEP_SECONDS = 5.5;
/* The hero's order, sell ETH forward to 26 Mar 2027, quoted around that maturity's mark (4,231.90). */
const QUOTES = ["Maker A 4,229.40", "Maker B 4,232.10", "Maker C 4,230.60"];
const RECEIPT = `receipt  0x7c1e…b40a
market   ETH 26MAR27 forward
quote    Maker B, firm
price    4,232.10 USDC
fixing   26 Mar 2027 16:00 LDN
payout   +18,420.00 USDC
fees     61.42 USDC`;

/**
 * Part 03 in zk.email's blueprint style. The card follows one order on a
 * detail of the painting: the request goes private, three makers quote on
 * it, and it settles into a receipt, wiping between steps along taceo's
 * diagonal. Beside it, zk.email's step list,
 * advancing on a timer, then its "in action" cards.
 */
export default function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  // Auto-advance while the section is on screen; the bar shows the time left.
  useGSAP(
    () => {
      const bar = root.current!.querySelector<HTMLElement>(`[data-step="${active}"] .${styles.progress}`);
      if (!bar) return;
      const timer = gsap.fromTo(
        bar,
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: STEP_SECONDS,
          ease: "none",
          paused: true,
          onComplete: () => setActive((index) => (index + 1) % STEPS.length),
        },
      );
      ScrollTrigger.create({
        trigger: root.current,
        start: "top 70%",
        end: "bottom 30%",
        onToggle: (self) => (self.isActive ? timer.play() : timer.pause()),
      });
    },
    { dependencies: [active], scope: root, revertOnUpdate: true },
  );

  return (
    <section ref={root} id="how" className={styles.how} data-theme="dark" data-phase="2">
      <div className="container">
        <header className={styles.head}>
          <PhaseTag phase={3}>How it works</PhaseTag>
          <h2 className={styles.title} data-reveal>
            From exposure to receipt
          </h2>
          <p className={styles.sub} data-reveal>
            One order and instrument model sits underneath, so a hedge built in Protect and a trade placed in Trade become
            the same kind of position.
          </p>
        </header>

        <div className={styles.flow}>
          {/* One order, step by step: requested privately, quoted by three makers, settled with a receipt */}
          <figure className={styles.proof} data-reveal>
            <Diamonds />
            <div className={styles.frames} aria-hidden="true">
              <div className={styles.frame} data-active={active === 0 || undefined}>
                {/* eslint-disable @next/next/no-img-element */}
                <img className={styles.crop} src="/aztec/news-bg.webp" alt="" />
                <img className={`${styles.crop} ${styles.sweep}`} src="/aztec/news-bg-halftone.png" alt="" />
              </div>
              <div className={styles.frame} data-active={active === 1 || undefined}>
                {QUOTES.map((quote, index) => (
                  <div key={quote} className={styles.share} style={{ ["--share" as string]: index }}>
                    <img className={styles.crop} src="/aztec/news-bg-halftone.png" alt="" />
                    <span className="mono">{quote}</span>
                  </div>
                ))}
                {/* eslint-enable @next/next/no-img-element */}
              </div>
              <div className={`${styles.frame} ${styles.proven}`} data-active={active === 2 || undefined}>
                <pre className="mono">{RECEIPT}</pre>
                <span className={`mono ${styles.stamp}`}>Settled in USDC</span>
              </div>
            </div>
            <figcaption className={styles.sees}>
              <span className="label">{STEPS[active].who}</span>
              <span className="mono">{STEPS[active].sees}</span>
            </figcaption>
          </figure>

          <ol className={styles.steps}>
            {STEPS.map(({ name, title, body, icon }, index) => (
              <li key={name} data-step={index} className={styles.step} data-active={active === index || undefined}>
                <button type="button" className={styles.stepButton} onClick={() => setActive(index)} data-sfx="ui">
                  <span className={styles.stepText}>
                    <span className={`mono ${styles.stepIndex}`}>0{index + 1}</span>
                    <strong>{title}</strong>
                    <span className={styles.stepBody}>{body}</span>
                    <span className={styles.more}>Learn more →</span>
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.stepIcon} src={icon} alt="" />
                </button>
                <span className={styles.progress} aria-hidden="true" />
              </li>
            ))}
          </ol>
        </div>

        <h3 className={styles.actionTitle} data-reveal>
          Who it&apos;s for
        </h3>
        <div className={styles.actions}>
          {USE_CASES.map(({ title, body, image }) => (
            <article key={title} className={styles.case} data-reveal>
              <Diamonds />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.caseImage} src={image} alt="" />
              <h4>{title}</h4>
              <p>{body}</p>
            </article>
          ))}
          <a href="/protect/new" className={`${styles.case} ${styles.caseOpen}`} data-reveal data-sfx="ui" data-cursor="Protect">
            <span className={styles.plus} aria-hidden="true" />
            <h4>Your exposure</h4>
            <p>Receivables, inventory, debt, a fund&apos;s basis trade or a maker&apos;s quote surface. Describe it in Protect and see what the hedge costs.</p>
          </a>
        </div>
      </div>
    </section>
  );
}
