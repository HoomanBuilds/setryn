"use client";

import { useRef } from "react";
import { useExperience } from "@/components/landing/Experience";
import Button from "@/components/landing/ui/Button";
import { ArbitrumMark } from "@/components/landing/ui/Chain";
import { DECODE_CHARS, gsap, SplitText, useGSAP } from "@/lib/landing/gsap";
import { sound } from "@/lib/landing/sound";
import styles from "./RedactedHero.module.css";

/** How far the divider leans: horizontal offset between its top and bottom, as a share of the height. */
const LEAN = 0.14;

const f = (value: number) => value.toFixed(1);

/**
 * The Setryn hero, light and editorial: taceo's paper, labels and giant type
 * naming the exchange.
 * Below, zk.email's hero card rises from the bottom edge holding aztec's
 * painting, split by a draggable diagonal: the scene as a public order book
 * shows it, and as a private RFQ leaves it (taceo halftone). Scrolling opens the card to full bleed and
 * sweeps the divider across, until only the halftone is left.
 */
export default function RedactedHero() {
  const { stage } = useExperience();
  const root = useRef<HTMLElement>(null);
  // drag: where the divider rests (0 to 1), set by the intro glide. auto: the scroll's push to the far edge.
  // anchor: where the push starts from.
  const divider = useRef({ drag: 0, auto: 0, anchor: 0 });

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const scene = q<HTMLElement>(`.${styles.stage}`)[0];
      const shielded = q<HTMLElement>(`.${styles.shielded}`)[0];
      const line = q<SVGLineElement>(`.${styles.split} line`)[0];
      const frame = q<HTMLElement>(`.${styles.frame}`)[0];
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const state = divider.current;
      if (reduced) state.drag = 0.5;

      const draw = () => {
        const { clientWidth: w, clientHeight: h } = scene;
        // The scroll pushes the divider off the left edge, leaving only the shielded side.
        if (state.auto <= 0) state.anchor = 0;
        const push = state.anchor >= 0.999 ? 0 : gsap.utils.clamp(0, 1, (state.auto - state.anchor) / (1 - state.anchor));
        const position = state.drag + (-LEAN - state.drag) * push;
        const lean = h * LEAN;
        const [top, bottom] = [position * w + lean / 2, position * w - lean / 2];
        shielded.style.clipPath = `polygon(${f(top)}px 0, ${f(w + lean)}px 0, ${f(w + lean)}px ${h}px, ${f(bottom)}px ${h}px)`;
        line.setAttribute("x1", f(top));
        line.setAttribute("x2", f(bottom));
        line.setAttribute("y2", String(h));
      };
      gsap.ticker.add(draw);

      if (reduced) return () => gsap.ticker.remove(draw);

      const split = SplitText.create(q("[data-line]"), { type: "words", mask: "words", wordsClass: "split-word" });


      gsap.set(split.words, { yPercent: 140 });
      gsap.set(q("[data-hero-fade]"), { opacity: 0, y: 16, filter: "blur(8px)" });
      gsap.set(q(`.${styles.window}`), { yPercent: 60, opacity: 0 });

      // The card opens to full bleed as the page scrolls (aztec's scroll, smoothed).
      const gutter = () => parseFloat(getComputedStyle(q(".container")[0]).paddingLeft);
      const cardTop = () => scene.clientHeight * (scene.clientWidth <= 760 ? 0.62 : 0.56);
      gsap
        .timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom bottom",
            scrub: 1,
            invalidateOnRefresh: true,
          },
        })
        .fromTo(
          q(`.${styles.window}`),
          { clipPath: () => `inset(${cardTop()}px ${gutter()}px 0px ${gutter()}px round 22px 22px 0px 0px)` },
          { clipPath: "inset(0px 0px 0px 0px round 0px 0px 0px 0px)", duration: 0.6 },
          0,
        )
        .fromTo(
          frame,
          { top: cardTop, left: gutter, right: gutter },
          { top: 0, left: 0, right: 0, duration: 0.6 },
          0,
        )
        .to(q(`.${styles.top}`), { yPercent: -40, opacity: 0, duration: 0.45 }, 0)
        .fromTo(q(`.${styles.painting}`), { scale: 1.1 }, { scale: 1, duration: 1 }, 0)
        .to(state, { auto: 1, duration: 0.6, ease: "power1.inOut" }, 0.3)
        .fromTo(q(`.${styles.closing}`), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.2 }, 0.78);

      return () => gsap.ticker.remove(draw);
    },
    { scope: root },
  );

  // The reveal: the headline sets, then redacts its own last word.
  useGSAP(
    () => {
      if (stage === "intro" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);
      const labels = q<HTMLElement>(`.${styles.labels} [data-scramble]`);
      gsap
        .timeline({ delay: 0.3, defaults: { ease: "power3.out" } })
        .to(q(".split-word"), { yPercent: 0, duration: 1.1, stagger: 0.07 }, 0.2)
        .add(() => sound.play("DecodingUI"), 0.3)
        .add(() => {
          labels.forEach((label) =>
            gsap.to(label, { duration: 0.9, scrambleText: { text: label.textContent!, chars: DECODE_CHARS, speed: 0.5 } }),
          );
        }, 0.3)
        .to(q("[data-hero-fade]"), { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: 0.1 }, 1)
        .to(q(`.${styles.window}`), { yPercent: 0, opacity: 1, duration: 1.6, ease: "expo.out" }, 1.1)
        // The divider glides to the middle on its own.
        .add(() => {
          gsap.to(divider.current, { drag: 0.5, duration: 1.6, ease: "expo.inOut" });
        }, 1.6);
    },
    { dependencies: [stage === "intro"], scope: root },
  );

  return (
    <section ref={root} id="settle" className={styles.hero} data-theme="paper" data-phase="0">
      <div className={styles.stage}>
        <div className={`container ${styles.top}`}>
          <div className={styles.labels}>
            <span className="label">
              <span data-scramble>Private dated-risk exchange</span>
            </span>
            <span className={`label ${styles.chain}`}>
              <ArbitrumMark size={20} />
              <span data-scramble>On Arbitrum</span>
            </span>
          </div>
          <div className={styles.headline}>
            <h1 className={styles.title}>
              <span data-line>Private exchange</span>
              <span data-line>for dated risk</span>
            </h1>
            <div className={styles.side} data-hero-fade>
              <p>
                Setryn is an exchange for risk with a date on it. Enter what you need to buy or sell and when, ask the
                makers you choose for a firm price, and clear the hedge against native USDC.
              </p>
              <div className={styles.actions}>
                <Button href="#how">How it works</Button>
                <Button href="#problem" variant="outline">
                  Why dated risk
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* zk.email's hero card: the painting as a public chain shows it, and as Setryn leaves it */}
        <div className={styles.window}>
          {/* eslint-disable @next/next/no-img-element */}
          <img className={styles.painting} src="/aztec/news-bg.webp" alt="" draggable={false} />
          <div className={styles.shielded}>
            <img className={styles.painting} src="/aztec/news-bg-halftone.png" alt="" draggable={false} />
          </div>
          {/* eslint-enable @next/next/no-img-element */}
          <svg className={styles.split} aria-hidden="true">
            <line y1="0" />
          </svg>
          <p className={styles.closing}>
            Only the makers you invite see the request.
          </p>
        </div>

        <div className={styles.frame} aria-hidden="true">
          <span className={`label ${styles.tag}`}>Public order book</span>
          <span className={`label ${styles.tag} ${styles.tagShielded}`}>Private RFQ</span>
        </div>
      </div>
    </section>
  );
}
