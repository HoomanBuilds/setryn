"use client";

import { A11y, EffectCoverflow, Keyboard, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-coverflow";
import { Arrow } from "@/components/landing/ui/Button";
import styles from "./FieldNotes.module.css";

const NOTES = [
  {
    tag: "Essay",
    title: "Why dated risk, and not another perp DEX",
    read: "7 min",
    image: "/aztec/projects.webp",
  },
  {
    tag: "Engineering",
    title: "How portfolio margin nets a collar against a forward",
    read: "9 min",
    image: "/taceo/merces-halftone-portrait-back.webp",
  },
  {
    tag: "Product",
    title: "Firm or indicative: how every quote is labelled",
    read: "5 min",
    image: "/hatom/paint-swirl.jpg",
  },
  {
    tag: "Compliance",
    title: "Receipts you can hand to an auditor",
    read: "6 min",
    image: "/aztec/header-bg.webp",
  },
  {
    tag: "Research",
    title: "Fixing a market that closes on a public holiday",
    read: "8 min",
    image: "/dymension/rollapp-gradient.png",
  },
  {
    tag: "Guide",
    title: "Rolling a hedge to the next expiry",
    read: "4 min",
    image: "/aztec/news-bg.webp",
  },
];

/** dymension's blog carousel: a looping Swiper coverflow. The first notes are still being written, so none carries a date. */
export default function FieldNotes() {
  return (
    <section id="field-notes" className={styles.notes} data-theme="warm" data-phase="4">
      <div className={`container ${styles.head}`}>
        <h2 className={styles.title} data-reveal>
          Field notes
        </h2>
        <div className={styles.nav}>
          <button type="button" className={styles.prev} aria-label="Previous note" data-sfx="ui">
            <Arrow />
          </button>
          <button type="button" className={styles.next} aria-label="Next note" data-sfx="ui">
            <Arrow />
          </button>
        </div>
      </div>

      <Swiper
        className={styles.swiper}
        modules={[EffectCoverflow, Navigation, Keyboard, A11y]}
        effect="coverflow"
        slidesPerView="auto"
        centeredSlides
        loop
        grabCursor
        keyboard={{ enabled: true, onlyInViewport: true }}
        spaceBetween={-60}
        navigation={{ prevEl: `.${styles.prev}`, nextEl: `.${styles.next}`, addIcons: false }}
        coverflowEffect={{ rotate: 40, stretch: 0, depth: 120, modifier: 1, slideShadows: false }}
      >
        {NOTES.map(({ tag, title, read, image }) => (
          <SwiperSlide key={title} className={styles.slide}>
            <article className={styles.card} data-cursor="Drag">
              <div className={styles.imageWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" loading="lazy" />
                <span className={`label ${styles.tag}`}>{tag}</span>
              </div>
              <div className={styles.body}>
                <h3>{title}</h3>
                <p className="mono">Coming soon, {read} read</p>
              </div>
            </article>
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  );
}
