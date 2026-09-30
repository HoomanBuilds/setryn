"use client";

import { useRef, useState, type FormEvent } from "react";
import { Arrow } from "@/components/landing/ui/Button";
import { ArbitrumMark, UsdcMark } from "@/components/landing/ui/Chain";
import { APP_LINKS } from "@/lib/landing/app-links";
import { gsap, useGSAP } from "@/lib/landing/gsap";
import styles from "./Footer.module.css";

type FooterLink = { label: string; href: string; mark?: "arbitrum" | "usdc" | "x" };

/** The X (Twitter) logo. */
function XMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Every link opens a real platform route, a section of this page, or the network's own site. */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Protect", href: APP_LINKS.protect },
      { label: "Trade", href: APP_LINKS.trade },
      { label: "Markets", href: APP_LINKS.markets },
      { label: "Make markets", href: APP_LINKS.maker },
    ],
  },
  {
    title: "Protocol",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Execution modes", href: "#network" },
      { label: "Risk and margin", href: "/portfolio/risk" },
      { label: "Fixing and settlement", href: "/lifecycle" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Receipts", href: "/receipts" },
      { label: "Developers", href: "/developers" },
      { label: "Partners", href: "/partners" },
      { label: "System status", href: "/status" },
    ],
  },
  {
    title: "Network",
    links: [
      { label: "Arbitrum One", href: "https://arbitrum.io", mark: "arbitrum" },
      { label: "Native USDC", href: "https://www.circle.com/usdc", mark: "usdc" },
    ],
  },
  {
    title: "Follow",
    links: [{ label: "@SetrynX", href: "https://x.com/SetrynX", mark: "x" }],
  },
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
                {links.map(({ label, href, mark }) => {
                  const external = href.startsWith("http");
                  return (
                    <li key={label}>
                      <a
                        href={href}
                        className={mark ? styles.marked : undefined}
                        data-sfx="ui"
                        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                      >
                        {mark === "arbitrum" && <ArbitrumMark size={18} />}
                        {mark === "usdc" && <UsdcMark size={18} />}
                        {mark === "x" && <XMark size={16} />}
                        {label}
                        {external && <span aria-hidden="true"> ↗</span>}
                      </a>
                    </li>
                  );
                })}
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
        <a className={styles.builtOn} href="https://arbitrum.io" target="_blank" rel="noreferrer" data-sfx="ui">
          <span className={styles.builtOnMark}>
            <ArbitrumMark size={30} />
          </span>
          <span>
            <span className="label">Built on</span>
            <strong>Arbitrum One</strong>
          </span>
        </a>
        <span className={styles.legalText}>
          <span>© 2026 Setryn Labs</span>
          <span className={styles.credits}>Trading dated instruments carries a risk of loss.</span>
        </span>
      </div>
    </footer>
  );
}
