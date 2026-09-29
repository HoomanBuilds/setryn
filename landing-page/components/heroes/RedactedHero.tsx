"use client";

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useExperience } from "@/components/Experience";
import Button from "@/components/ui/Button";
import { DECODE_CHARS, gsap, SplitText, useGSAP } from "@/lib/gsap";
import { sound } from "@/lib/sound";
import styles from "./RedactedHero.module.css";

/** How far the divider leans: horizontal offset between its top and bottom, as a share of the height. */
const LEAN = 0.14;

const f = (value: number) => value.toFixed(1);

/**
 * Hero B, light and editorial: taceo's paper, labels and giant type setting
 * out a dated order, its size redacted by a mint bar you can peek under.
 * Below, zk.email's hero card rises from the bottom edge holding aztec's
 * painting, split by a draggable diagonal: the scene as a public order book
 * shows it, and as a private RFQ leaves it (taceo halftone). Scrolling opens the card to full bleed and
 * sweeps the divider across, until only the halftone is left.
 */
export default function RedactedHero() {
  const { stage } = useExperience();
  const root = useRef<HTMLElement>(null);
  // drag: where the reader left the divider (0 to 1). auto: the scroll's push to the far edge.
  // anchor: how far the push had got when the reader last moved it; the push carries on from there.
  // touched: the reader has moved it, so the intro leaves it alone.
  const divider = useRef({ drag: 0, auto: 0, anchor: 0, touched: false });

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const scene = q<HTMLElement>(`.${styles.stage}`)[0];
      const shielded = q<HTMLElement>(`.${styles.shielded}`)[0];
      const line = q<SVGLineElement>(`.${styles.split} line`)[0];
      const handle = q<HTMLElement>(`.${styles.handle}`)[0];
      const frame = q<HTMLElement>(`.${styles.frame}`)[0];
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const state = divider.current;
      if (reduced) state.drag = 0.5;

      const draw = () => {
        const { clientWidth: w, clientHeight: h } = scene;
        // The scroll pushes the divider off the left edge, leaving only the shielded side. It pushes
        // from wherever the reader last left it, so a drag is never overruled by the scroll.
        if (state.auto <= 0) state.anchor = 0;
        const push = state.anchor >= 0.999 ? 0 : gsap.utils.clamp(0, 1, (state.auto - state.anchor) / (1 - state.anchor));
        const position = state.drag + (-LEAN - state.drag) * push;
        const lean = h * LEAN;
        const [top, bottom] = [position * w + lean / 2, position * w - lean / 2];
        shielded.style.clipPath = `polygon(${f(top)}px 0, ${f(w + lean)}px 0, ${f(w + lean)}px ${h}px, ${f(bottom)}px ${h}px)`;
        line.setAttribute("x1", f(top));
        line.setAttribute("x2", f(bottom));
        line.setAttribute("y2", String(h));
        // The handle rides the divider, halfway down the visible card.
        const frameTop = frame.offsetTop;
        const y = frameTop + (h - frameTop) / 2;
        handle.style.transform = `translate(${f(top + ((bottom - top) * y) / h)}px, ${f(y)}px)`;
        const value = String(Math.round(gsap.utils.clamp(0, 1, position) * 100));
        if (handle.getAttribute("aria-valuenow") !== value) handle.setAttribute("aria-valuenow", value);
      };
      gsap.ticker.add(draw);

      if (reduced) return () => gsap.ticker.remove(draw);

      const split = SplitText.create(q("[data-line]"), { type: "words", mask: "words", wordsClass: "split-word" });

      // Peek under the redaction to see the order size. Listeners go on the
      // split DOM, which React no longer tracks.
      const redacted = q<HTMLElement>(`.${styles.redacted}`)[0];
      const bar = redacted.querySelector(`.${styles.bar}`);
      const peek = (open: boolean) => () => {
        gsap.to(bar, { xPercent: open ? 104 : 0, duration: 0.5, ease: "power3.out", overwrite: "auto" });
        if (open) sound.play("HoverUI_In");
      };
      redacted.addEventListener("pointerenter", peek(true));
      redacted.addEventListener("pointerleave", peek(false));

      gsap.set(split.words, { yPercent: 115 });
      gsap.set(q(`.${styles.bar}`), { scaleX: 0 });
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
      const labels = q<HTMLElement>(`.${styles.labels} span`);
      gsap
        .timeline({ delay: 0.3, defaults: { ease: "power3.out" } })
        .to(q(".split-word"), { yPercent: 0, duration: 1.1, stagger: 0.07 }, 0.2)
        .add(() => sound.play("DecodingUI"), 0.3)
        .add(() => {
          labels.forEach((label) =>
            gsap.to(label, { duration: 0.9, scrambleText: { text: label.textContent!, chars: DECODE_CHARS, speed: 0.5 } }),
          );
        }, 0.3)
        .to(q(`.${styles.bar}`), { scaleX: 1, duration: 0.7, ease: "power4.inOut" }, 1.25)
        .add(() => sound.play("ClickUI"), 1.4)
        .to(q("[data-hero-fade]"), { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: 0.1 }, 1)
        .to(q(`.${styles.window}`), { yPercent: 0, opacity: 1, duration: 1.6, ease: "expo.out" }, 1.1)
        // The divider glides to the middle, unless the reader has already taken hold of it.
        .add(() => {
          if (!divider.current.touched) gsap.to(divider.current, { drag: 0.5, duration: 1.6, ease: "expo.inOut" });
        }, 1.6);
    },
    { dependencies: [stage === "intro"], scope: root },
  );

  // Dragging and keyboard for the divider. A drag starts on the handle, or (with a mouse or pen)
  // anywhere on the card, and follows the pointer across the whole window until it is released.
  const place = (drag: number) => {
    const state = divider.current;
    // The intro's own glide gives way to the reader, and the scroll pushes on from here.
    gsap.killTweensOf(state, "drag");
    state.touched = true;
    state.drag = gsap.utils.clamp(0.04, 0.96, drag);
    state.anchor = state.auto;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const onHandle = event.currentTarget.getAttribute("role") === "slider";
    if (!onHandle && event.pointerType === "touch") return;
    // No text selection, no native image drag, no jump to bring the handle into view.
    event.preventDefault();
    const scene = event.currentTarget.closest<HTMLElement>(`.${styles.stage}`)!;
    scene.querySelector<HTMLElement>(`.${styles.handle}`)!.focus({ preventScroll: true });
    const id = event.pointerId;
    const follow = (clientX: number) => {
      const box = scene.getBoundingClientRect();
      place((clientX - box.left) / box.width);
    };
    const move = (e: PointerEvent) => e.pointerId === id && follow(e.clientX);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      delete scene.dataset.dragging;
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
    };
    follow(event.clientX);
    scene.dataset.dragging = "";
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowLeft: -0.05, ArrowRight: 0.05 }[event.key];
    if (!step) return;
    event.preventDefault();
    place(divider.current.drag + step);
  };

  return (
    <section ref={root} id="settle" className={styles.hero} data-theme="paper" data-phase="0">
      <div className={styles.stage}>
        <div className={`container ${styles.top}`}>
          <div className={styles.labels}>
            <span className="label">Private dated-risk exchange</span>
            <span className="label">On Arbitrum One</span>
          </div>
          <div className={styles.headline}>
            <h1 className={styles.title}>
              <span data-line>
                Sell{" "}
                <span className={styles.redacted} data-cursor="Peek">
                  <span>2,400</span>
                  <i className={styles.bar} aria-hidden="true">
                    <span className="mono">redacted</span>
                  </i>
                </span>{" "}
                ETH
              </span>
              <span data-line>on 26 March 2027</span>
            </h1>
            <div className={styles.side} data-hero-fade>
              <p>
                Setryn is an exchange for risk with a date on it. Enter what you need to buy or sell and when, ask the
                makers you choose for a firm price, and clear the hedge against USDC.
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
        <div className={styles.window} onPointerDown={onPointerDown} data-cursor="Drag">
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

        <div
          className={styles.handle}
          role="slider"
          tabIndex={0}
          aria-label="Compare a public order book with a private RFQ"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={50}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          data-cursor="Drag"
        >
          <span aria-hidden="true">‹ ›</span>
        </div>
      </div>
    </section>
  );
}
