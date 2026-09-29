"use client";

import { useRef } from "react";
import { useExperience } from "@/components/Experience";
import Button from "@/components/ui/Button";
import { DECODE_CHARS, gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import { inkBlob } from "@/lib/ink";
import { sound } from "@/lib/sound";
import styles from "./ShieldHero.module.css";

/** The slab's resting tilt (degrees), centre height and half-thickness, as fractions of the stage. */
const SLAB = {
  desktop: { angle: 12, centreY: 0.5, rest: 0.24 },
  mobile: { angle: 16, centreY: 0.44, rest: 0.25 },
};
const LENS_RADIUS = 96;

type Point = [number, number];
const f = (value: number) => value.toFixed(1);

/**
 * The hero is one idea, told in scroll. The enter burst opens onto aztec's
 * village painting in colour: the public ledger. A taceo slab crosses it, and
 * inside the slab the same scene is printed as mint halftone: shielded.
 * Scrolling widens the slab until nothing public is left (aztec's additive,
 * smoothed scroll choreography), the headline pulls together, and SETRYN
 * appears as letters cut out of the dots. The cursor is hatom's ink, here a
 * lens that shields whatever it passes over.
 */
export default function ShieldHero() {
  const { stage } = useExperience();
  const root = useRef<HTMLElement>(null);
  // intro: 0 to 1 as the slab slides in. scroll: 0 to 1 as it swallows the scene.
  const slab = useRef({ intro: 0, scroll: 0 });

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const scene = q<HTMLElement>(`.${styles.stage}`)[0];
      const shield = q<HTMLElement>(`.${styles.shield}`)[0];
      const [edgeTop, edgeBottom] = q<SVGLineElement>(`.${styles.edges} line`);
      const labels = q<HTMLElement>(`.${styles.edgeLabels}`)[0];
      const meterValue = q<HTMLElement>("[data-meter-value]")[0];
      const meterBar = q<HTMLElement>("[data-meter-bar]")[0];
      const meterHint = q<HTMLElement>("[data-meter-hint]")[0];
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
      const state = slab.current;
      if (reduced) state.intro = 1;

      const lens = { x: 0, y: 0, r: 0, target: 0, tx: 0, ty: 0, time: 0 };
      let shielded = false;

      const draw = () => {
        const { clientWidth: w, clientHeight: h } = scene;
        const config = w <= 760 ? SLAB.mobile : SLAB.desktop;
        const angle = (config.angle * Math.PI) / 180;
        const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
        const [nx, ny] = [-dy, dx];
        const [cx, cy] = [w / 2, h * config.centreY];
        const rest = h * config.rest;
        const full = Math.hypot(w, h) / 2 + 24;
        const half = rest * state.intro + (full - rest) * state.scroll;
        const reach = w + h;
        const at = (along: number, across: number): Point => [cx + dx * along + nx * across, cy + dy * along + ny * across];

        // Clockwise, like the ink blob, so the two join under nonzero filling.
        const corners = [at(reach, half), at(-reach, half), at(-reach, -half), at(reach, -half)];
        let path = `M${corners.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
        if (lens.r > 1) path += inkBlob(lens.x, lens.y, lens.r, lens.time, { wobble: 0.14, spikes: 0.3, seed: 2.4 });
        shield.style.clipPath = `path("${path}")`;

        // taceo's hairlines along both edges of the slab.
        for (const [line, side] of [
          [edgeTop, -1],
          [edgeBottom, 1],
        ] as const) {
          const [[x1, y1], [x2, y2]] = [at(-reach, side * half), at(reach, side * half)];
          line.setAttribute("x1", f(x1));
          line.setAttribute("y1", f(y1));
          line.setAttribute("x2", f(x2));
          line.setAttribute("y2", f(y2));
        }

        // zk.email-style annotations riding the top edge: public above it, private below.
        const [lx, ly] = at((w * 0.78 - cx - dy * half) / dx, -half);
        labels.style.transform = `translate(${f(lx)}px, ${f(ly)}px) rotate(${config.angle}deg)`;
        labels.style.opacity = String(Math.min(1, state.intro * 1.4) * Math.max(0, 1 - state.scroll * 1.8));

        const percent = Math.round(Math.min(1, state.scroll / 0.7) * 100);
        meterValue.textContent = `${percent}%`;
        meterBar.style.transform = `scaleX(${percent / 100})`;
        if (percent === 100 && !shielded) {
          shielded = true;
          meterHint.textContent = "Fully private";
          sound.play("DecodingUI");
        } else if (percent < 100 && shielded) {
          shielded = false;
          meterHint.textContent = "Scroll to go private";
        }
      };

      const tick = (_time: number, deltaMs: number) => {
        const dt = Math.min(deltaMs, 50) / 1000;
        const ease = 1 - Math.exp(-dt * 10);
        lens.time += dt * 0.7;
        lens.x += (lens.tx - lens.x) * ease;
        lens.y += (lens.ty - lens.y) * ease;
        lens.r += (lens.target - lens.r) * ease;
        draw();
      };
      draw();

      // Draw every frame only while the hero is on screen.
      ScrollTrigger.create({
        trigger: root.current,
        start: "top bottom",
        end: "bottom top",
        onToggle: (self) => (self.isActive ? gsap.ticker.add(tick) : gsap.ticker.remove(tick)),
      });
      const cleanup = () => gsap.ticker.remove(tick);

      if (reduced) return cleanup;

      // hatom's ink as a lens that follows the pointer.
      if (finePointer) {
        const move = (event: PointerEvent) => {
          const box = scene.getBoundingClientRect();
          lens.tx = event.clientX - box.left;
          lens.ty = event.clientY - box.top;
          if (!lens.target) [lens.x, lens.y] = [lens.tx, lens.ty];
          lens.target = LENS_RADIUS;
        };
        const leave = () => (lens.target = 0);
        scene.addEventListener("pointermove", move);
        scene.addEventListener("pointerleave", leave);
      }

      // Hidden until the enter burst reveals the page.
      const split = SplitText.create(q("[data-line]"), { type: "words", mask: "words", wordsClass: "split-word" });
      gsap.set(split.words, { yPercent: 115 });
      gsap.set(q("[data-hero-fade]"), { opacity: 0, y: 16, filter: "blur(8px)" });
      gsap.set(q(`.${styles.kicker}`), { opacity: 0 });
      gsap.set(q(`.${styles.edges}`), { opacity: 0 });

      // aztec's scroll: every element moves a step further with each scroll
      // step, smoothed (scrub) the way its Webflow interactions are.
      const lineA = q<HTMLElement>("[data-line='a']")[0];
      const lineB = q<HTMLElement>("[data-line='b']")[0];
      const room = (line: HTMLElement) => line.parentElement!.clientWidth - line.offsetWidth;
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
        .to(state, { scroll: 1, duration: 1, ease: "power1.in" }, 0)
        .fromTo(lineA, { x: 0 }, { x: () => room(lineA) / 2, duration: 0.6 }, 0)
        .fromTo(lineB, { x: () => room(lineB) }, { x: () => room(lineB) / 2, duration: 0.6 }, 0)
        .fromTo(q(`.${styles.picture}`), { scale: 1.12 }, { scale: 1, duration: 1 }, 0)
        .fromTo(q(`.${styles.wordmark}`), { scale: 1.35, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "power2.out" }, 0.3)
        .to(q(`.${styles.kicker} span`), { yPercent: -120, duration: 0.25 }, 0.5);

      return cleanup;
    },
    { scope: root },
  );

  // The reveal, played as the enter burst opens.
  useGSAP(
    () => {
      if (stage === "intro" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);
      const kicker = q<HTMLElement>(`.${styles.kicker} span`)[0];
      gsap
        .timeline({ delay: 0.3, defaults: { ease: "power3.out" } })
        .fromTo(q(`.${styles.painting}`), { scale: 1.2 }, { scale: 1, duration: 2.6, ease: "expo.out" }, 0)
        .to(slab.current, { intro: 1, duration: 1.6, ease: "expo.inOut" }, 0.2)
        .to(q(`.${styles.edges}`), { opacity: 1, duration: 1 }, 0.9)
        .to(q(".split-word"), { yPercent: 0, duration: 1.2, stagger: 0.07 }, 0.7)
        .set(q(`.${styles.kicker}`), { opacity: 1 }, 1)
        .add(() => sound.play("DecodingUI"), 1)
        .to(kicker, { duration: 1, scrambleText: { text: kicker.textContent!, chars: DECODE_CHARS, speed: 0.5 } }, 1)
        .to(q("[data-hero-fade]"), { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: 0.12 }, 1.3);
    },
    { dependencies: [stage === "intro"], scope: root },
  );

  return (
    <section ref={root} id="settle" className={styles.hero} data-theme="dark" data-phase="0">
      <div className={styles.stage} data-cursor="none">
        {/* The public scene: aztec's painting in colour */}
        <div className={styles.picture} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.painting} src="/aztec/news-bg.webp" alt="" />
        </div>

        {/* The shielded scene: the same painting in taceo halftone, SETRYN cut out of the dots */}
        <div className={styles.shield} aria-hidden="true">
          <div className={styles.picture}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.painting} src="/aztec/news-bg-halftone.png" alt="" />
          </div>
          <span className={styles.wordmark}>SETRYN</span>
        </div>

        <svg className={styles.edges} aria-hidden="true">
          <line />
          <line />
        </svg>
        <div className={styles.edgeLabels} aria-hidden="true">
          <span className="mono">Public book ↑</span>
          <span className="mono">Private RFQ ↓</span>
        </div>

        <div className={styles.scrim} aria-hidden="true" />

        <div className={`container ${styles.content}`}>
          <p className={styles.kicker}>
            <span>On Arbitrum One</span>
          </p>
          <h1 className={styles.title}>
            <span data-line="a">Private exchange</span>
            <span data-line="b">for dated risk</span>
          </h1>
        </div>

        <div className={`container ${styles.bar}`}>
          <div className={styles.intro} data-hero-fade>
            <p>
              Lock in a price for a future date. Setryn lists fixed-expiry forwards, options and multi-leg strategies,
              lets public books and private quotes compete, and clears every position against USDC until it settles.
            </p>
            <div className={styles.actions}>
              <Button href="#how">How it works</Button>
              <Button href="#problem" variant="square">
                Why dated risk
              </Button>
            </div>
          </div>

          <div className={styles.meter} data-hero-fade>
            <span className={styles.meterIcon} aria-hidden="true" />
            <div className={styles.meterText}>
              <strong className="mono" data-meter-value>
                0%
              </strong>
              <span className={styles.meterTrack}>
                <i data-meter-bar />
              </span>
              <span className="label" data-meter-hint>
                Scroll to go private
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
