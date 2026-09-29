"use client";

import { useRef, useState, type FormEvent } from "react";
import { Arrow } from "@/components/ui/Button";
import { gsap, useGSAP } from "@/lib/gsap";
import styles from "./Footer.module.css";

const COLUMNS = [
  { title: "Product", links: [["Protect", "#build"], ["Trade", "#build"], ["Make markets", "#build"], ["Receipts", "#how"]] },
  { title: "Protocol", links: [["Overview", "#top"], ["Risk and margin", "#top"], ["Fixing rules", "#top"], ["Execution modes", "#network"]] },
  { title: "Company", links: [["About", "#top"], ["Field notes", "#field-notes"], ["Careers", "#top"], ["Brand", "#top"]] },
  { title: "Social", links: [["X", "#top"], ["GitHub", "#top"], ["Discord", "#top"], ["Telegram", "#top"]] },
];

/** zk.email's annotated wordmark: dimension lines with handwritten-style labels. */
const ANNOTATIONS = [
  { text: "Dated", className: "private" },
  { text: "Cleared", className: "final" },
  { text: "Verifiable", className: "verifiable" },
  { text: "Onchain", className: "onchain" },
] as const;

export default function Footer() {
  const root = useRef<HTMLElement>(null);
  const [subscribed, setSubscribed] = useState(false);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const timeline = gsap.timeline({
          scrollTrigger: { trigger: `.${styles.wordmark}`, start: "top 90%" },
          defaults: { ease: "power3.out" },
        });
        timeline
          .from(`.${styles.letters} span`, { yPercent: 100, duration: 1.1, stagger: 0.05 })
          .from(`.${styles.annotation} i`, { scale: 0, duration: 0.8, stagger: 0.1 }, 0.5)
          .from(`.${styles.annotation} b`, { opacity: 0, y: 8, duration: 0.6, stagger: 0.1 }, 0.7);
      });
      return () => media.revert();
    },
    { scope: root },
  );

  // Display only: there is no mailing list behind this demo.
  const subscribe = (event: FormEvent) => {
    event.preventDefault();
    setSubscribed(true);
  };

  return (
    <footer ref={root} className={styles.footer} data-theme="dark">
      <div className={`container ${styles.top}`}>
        <div className={styles.newsletter}>
          <h2 className={styles.newsTitle}>Setryn notes, once a month</h2>
          <form className={styles.form} onSubmit={subscribe}>
            <label className="sr-only" htmlFor="footer-email">
              Email address
            </label>
            <input id="footer-email" type="email" placeholder="you@company.com" required disabled={subscribed} />
            <button type="submit" aria-label="Subscribe" disabled={subscribed} data-sfx="cta">
              <Arrow />
            </button>
          </form>
          <p className={styles.formNote} role="status">
            {subscribed ? "Thanks. You're on the list for the next issue." : "New markets, product updates and research."}
          </p>
        </div>

        <nav className={styles.columns} aria-label="Footer">
          {COLUMNS.map(({ title, links }) => (
            <div key={title}>
              <p className="label">{title}</p>
              <ul>
                {links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} data-sfx="ui">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className={`container ${styles.wordmark}`} role="img" aria-label="Setryn">
        <div className={styles.letters} aria-hidden="true">
          {"SETRYN".split("").map((letter, index) => (
            <span key={index}>{letter}</span>
          ))}
        </div>
        {ANNOTATIONS.map(({ text, className }) => (
          <span key={text} className={`${styles.annotation} ${styles[className]}`} aria-hidden="true">
            <i />
            <b>{text}</b>
          </span>
        ))}
      </div>

      <div className={`container ${styles.legal}`}>
        <span>© 2026 Setryn Labs</span>
        <span className={styles.credits}>Trading dated instruments carries a risk of loss.</span>
      </div>
    </footer>
  );
}
