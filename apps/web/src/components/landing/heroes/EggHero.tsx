"use client";

import { useRef } from "react";
import { useExperience } from "@/components/landing/Experience";
import Button from "@/components/landing/ui/Button";
import { ArbitrumMark } from "@/components/landing/ui/Chain";
import { DECODE_CHARS, gsap, SplitText, useGSAP } from "@/lib/landing/gsap";
import { sound } from "@/lib/landing/sound";
import styles from "./EggHero.module.css";

/** Setryn's egg, normalised to a 1×1 box (the mark's 40×50 egg, stretched by the box's 4:5 ratio). */
const EGG = "M.5 0C.8 0 1 .36 1 .6 1 .84.775 1 .5 1 .225 1 0 .84 0 .6 0 .36.2 0 .5 0Z";
/** The mark's slash, which is where the egg cracks. */
const SLASH = { x1: 0.2, y1: 0.84, x2: 0.825, y2: 0.2 };

function Shell() {
  return (
    <div className={styles.shell}>
      <svg className={styles.outline} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        <path d={EGG} pathLength={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/**
 * Hero C, dark and sculptural: Setryn's own mark as the scene. hatom built its
 * site around a glowing egg that hatches; here the egg is filled with
 * dymension's spectrum sphere and sits on dymension's warm grid, crossed by the
 * mark's slash in hatom lime. The egg stands for a position: opened on one
 * date, due on another. Scrolling cracks it open along the slash (aztec's
 * smoothed scroll), and inside is what it pays out at expiry.
 */
export default function EggHero() {
  const { stage } = useExperience();
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const scene = q<HTMLElement>(`.${styles.stage}`)[0];
      const media = gsap.matchMedia();

      media.add(
        { motion: "(prefers-reduced-motion: no-preference)", fine: "(hover: hover) and (pointer: fine)" },
        (context) => {
          const { motion, fine } = context.conditions!;
          if (!motion) return;

          const split = SplitText.create(q("[data-line]"), { type: "words", mask: "words", wordsClass: "split-word" });
          gsap.set(split.words, { yPercent: 115 });
          gsap.set(q("[data-hero-fade]"), { opacity: 0, y: 16, filter: "blur(8px)" });
          gsap.set(q(`.${styles.half}`), { opacity: 0, scale: 0.86 });
          gsap.set(q(`.${styles.outline} path, .${styles.slash} line`), { strokeDashoffset: 1 });
          gsap.set(q(`.${styles.dot}`), { scale: 0 });
          gsap.set(q(`.${styles.label}`), { opacity: 0 });

          // hatom's egg floats; the pointer tilts it.
          gsap.to(q(`.${styles.float}`), { y: -12, duration: 3.4, ease: "sine.inOut", yoyo: true, repeat: -1 });
          let cleanup: (() => void) | undefined;
          if (fine) {
            const tilt = q<HTMLElement>(`.${styles.tilt}`)[0];
            const rotateX = gsap.quickTo(tilt, "rotationX", { duration: 1.2, ease: "power3.out" });
            const rotateY = gsap.quickTo(tilt, "rotationY", { duration: 1.2, ease: "power3.out" });
            const move = (event: PointerEvent) => {
              rotateY((event.clientX / innerWidth - 0.5) * 14);
              rotateX((event.clientY / innerHeight - 0.5) * -10);
            };
            scene.addEventListener("pointermove", move);
            cleanup = () => scene.removeEventListener("pointermove", move);
          }

          // The crack, driven by the scroll and smoothed like aztec's interactions.
          const centreShift = () => (scene.clientWidth <= 760 ? 0 : -scene.clientWidth * 0.14);
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
            .to(q(`.${styles.egg}`), { x: centreShift, duration: 0.5, ease: "power1.inOut" }, 0)
            .to(q(`.${styles.intro}`), { x: -80, opacity: 0, duration: 0.3 }, 0)
            .to(q(`.${styles.label}`), { opacity: 0, duration: 0.15 }, 0)
            .to(q(`.${styles.slash}`), { opacity: 0, duration: 0.2 }, 0.05)
            .to(q(`.${styles.halfA}`), { xPercent: -34, yPercent: -24, rotation: -10, duration: 0.55, ease: "power2.inOut" }, 0.05)
            .to(q(`.${styles.halfB}`), { xPercent: 34, yPercent: 24, rotation: 8, duration: 0.55, ease: "power2.inOut" }, 0.05)
            .fromTo(
              q(`.${styles.inside}`),
              { opacity: 0, scale: 0.7, filter: "blur(12px)" },
              { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.35, ease: "power2.out" },
              0.24,
            )
            .to(q(`.${styles.dot}`), { scale: 1.8, duration: 0.4 }, 0.5);
          return cleanup;
        },
      );
      return () => media.revert();
    },
    { scope: root },
  );

  // The reveal: the egg forms, the mark draws itself, the copy sets.
  useGSAP(
    () => {
      if (stage === "intro" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);
      const brand = q<HTMLElement>(`.${styles.brand}`)[0];
      gsap
        .timeline({ delay: 0.3, defaults: { ease: "power3.out" } })
        .to(q(`.${styles.half}`), { opacity: 1, scale: 1, duration: 1.8, ease: "expo.out" }, 0)
        .to(q(`.${styles.outline} path`), { strokeDashoffset: 0, duration: 1.6, ease: "power2.inOut" }, 0.2)
        .to(q(`.${styles.slash} line`), { strokeDashoffset: 0, duration: 0.9, ease: "power3.inOut" }, 0.9)
        .add(() => sound.play("Quick_Buildup"), 0.9)
        .to(q(`.${styles.dot}`), { scale: 1, duration: 0.8, ease: "back.out(3)" }, 1.4)
        .to(q(".split-word"), { yPercent: 0, duration: 1.1, stagger: 0.07 }, 0.5)
        .add(() => sound.play("DecodingUI"), 0.6)
        .to(brand, { duration: 0.9, scrambleText: { text: brand.textContent!, chars: DECODE_CHARS, speed: 0.5 } }, 0.6)
        .to(q("[data-hero-fade]"), { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: 0.1 }, 1)
        .to(q(`.${styles.label}`), { opacity: 1, duration: 0.8, stagger: 0.15 }, 1.6);
    },
    { dependencies: [stage === "intro"], scope: root },
  );

  return (
    <section ref={root} id="settle" className={styles.hero} data-theme="warm" data-phase="0">
      <div className={styles.stage}>
        <div className={styles.egg}>
          <div className={styles.float}>
            <div className={styles.tilt} onPointerEnter={() => sound.chime()} data-cursor="Listen">
              <div className={`${styles.half} ${styles.halfA}`}>
                <Shell />
              </div>
              <div className={`${styles.half} ${styles.halfB}`}>
                <Shell />
                <span className={styles.dot} aria-hidden="true" />
              </div>
              {/* What the crack lets out: the position at expiry */}
              <div className={styles.inside} aria-hidden="true">
                <span className="label">Fixed 26 Mar 2027, 16:00 London</span>
                <span className={styles.insideLine}>Settled in USDC</span>
              </div>
              <svg className={styles.slash} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                <line {...SLASH} pathLength={1} vectorEffect="non-scaling-stroke" />
              </svg>
              <span className={`mono ${styles.label} ${styles.labelShell}`} aria-hidden="true">
                Opened 28 Sep 2026
              </span>
              <span className={`mono ${styles.label} ${styles.labelSeed}`} aria-hidden="true">
                Expires 26 Mar 2027
              </span>
            </div>
          </div>
        </div>

        <h1 className="sr-only">Setryn, the private exchange for dated risk</h1>

        <div className={`container ${styles.intro}`}>
          <p className={styles.brand}>Setryn</p>
          <p className={styles.title} aria-hidden="true" data-line>
            Risk with a date on it
          </p>
          <p className={styles.lede} data-hero-fade>
            Setryn is an exchange for fixed-expiry forwards and multi-leg strategies. Each position is cleared against
            native USDC, managed to its expiry and settled from a published fixing.
          </p>
          <div className={styles.actions} data-hero-fade>
            <Button href="#how">How it works</Button>
            <a className={styles.down} href="#problem" aria-label="Scroll to the next section" data-sfx="ui">
              ↓
            </a>
            <span className={`label ${styles.chain}`}>
              <ArbitrumMark size={22} />
              Launching on Arbitrum One
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
