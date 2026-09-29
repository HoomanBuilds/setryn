import localFont from "next/font/local";

// Every face is kept locally next to this file and loaded through next/font/local.

/** taceo.io: PP Neue Montreal, the display face. */
export const display = localFont({
  src: [
    { path: "./fonts/neue-montreal-300.woff2", weight: "300" },
    { path: "./fonts/neue-montreal-400.woff2", weight: "400" },
    { path: "./fonts/neue-montreal-500.woff2", weight: "500" },
  ],
  variable: "--font-display",
});

/** zk.email: Newsreader, the editorial serif. */
export const serif = localFont({
  src: "./fonts/newsreader-latin.woff2",
  weight: "200 800",
  variable: "--font-serif",
});

/** zk.email: Fustat, body copy. */
export const body = localFont({
  src: "./fonts/fustat-latin.woff2",
  weight: "200 800",
  variable: "--font-body",
});

/** aztec.network: Arizona Serif Light, and its italic for the menu and footer annotations. */
export const arizona = localFont({
  src: [
    { path: "./fonts/arizona-serif-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/arizona-serif-italic-300.woff2", weight: "300", style: "italic" },
  ],
  variable: "--font-arizona",
});

/** aztec.network: MD Thermochrome, the monospace. */
export const mono = localFont({
  src: "./fonts/md-thermochrome-400.woff2",
  weight: "400",
  variable: "--font-mono",
});

/** hatom.com: OC Mikola, the spaced uppercase labels. */
export const label = localFont({
  src: [
    { path: "./fonts/oc-mikola-400.woff2", weight: "400" },
    { path: "./fonts/oc-mikola-500.woff2", weight: "500" },
  ],
  variable: "--font-label",
});

/** dymension.xyz: TWK Everett Medium, card titles. */
export const everett = localFont({
  src: "./fonts/everett-500.woff2",
  weight: "500",
  variable: "--font-everett",
});

export const fontVariables = [display, serif, body, arizona, mono, label, everett]
  .map((font) => font.variable)
  .join(" ");
