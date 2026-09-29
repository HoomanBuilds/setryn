/**
 * Downloads every file Setryn borrows from the five reference sites, straight
 * from each live site, and derives the pencil sketch used by the enter screen.
 *
 *   npm run assets              download / refresh everything
 *   npm run assets -- --check   verify local files match what the sites serve
 *
 * Files land in public/<site>/ (images, audio), app/fonts/ (fonts) and
 * app/data/sfx.json (hatom's sound sprite maps, read from its bundle).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECK = process.argv.includes("--check");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const SITES = {
  hatom: "https://www.hatom.com",
  zkemail: "https://zk.email",
  taceo: "https://taceo.io",
  aztec: "https://aztec.network",
  dymension: "https://dymension.xyz",
};

let allMatch = true;

async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
const downloadText = async (url) => (await download(url)).toString();

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Saves `data`, or in --check mode reports whether the local copy matches. */
async function syncFile(relPath, data, source) {
  const file = path.join(ROOT, relPath);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (CHECK) {
    const local = await readFile(file).catch(() => null);
    const same = local !== null && sha256(local) === sha256(bytes);
    console.log(`${same ? "ok  " : "DIFF"}  ${relPath}  <-  ${source}`);
    allMatch &&= same;
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  console.log(`saved ${relPath} (${bytes.length} bytes)  <-  ${source}`);
}

const syncUrl = async (url, relPath) => syncFile(relPath, await download(url), url);

/** Loads a page and the same-origin CSS/JS it links to, as one searchable string. */
async function loadSite(site, bundlePattern) {
  const html = await downloadText(site);
  const $ = cheerio.load(html);
  const bundles = new Set(html.match(bundlePattern) ?? []);
  const files = { html, $, css: "", js: "" };
  for (const bundle of bundles) {
    const text = await downloadText(new URL(bundle, site).href);
    files[bundle.endsWith(".css") ? "css" : "js"] += `${text}\n`;
  }
  files.css += $("style").text();
  return files;
}

/** Every @font-face in `css` as { family, weight, style, url, range }. */
function fontFaces(css, base) {
  return [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].flatMap(([, body]) => {
    const prop = (name) => body.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1].trim();
    const woff2 = body.match(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/);
    if (!woff2) return [];
    return [
      {
        family: prop("font-family").replace(/["']/g, ""),
        weight: prop("font-weight") ?? "400",
        style: prop("font-style") ?? "normal",
        range: prop("unicode-range") ?? "",
        url: new URL(woff2[1], base).href,
      },
    ];
  });
}

function findFace(faces, family, weight, style = "normal", site = "") {
  const face = faces.find(
    (f) =>
      (typeof family === "string" ? f.family === family : family.test(f.family)) &&
      f.weight === weight &&
      f.style === style &&
      // next/font splits Google fonts by script; the Latin file covers U+00xx.
      (!f.range || /u\+00\?\?/i.test(f.range)),
  );
  if (!face) throw new Error(`${site}: no ${family} ${weight} ${style} font face`);
  return face.url;
}

/** Finds `name` (the file name without its build hash) among the URLs in `source`. */
function findHashed(source, dir, name, site) {
  const [stem, ext] = [name.slice(0, name.lastIndexOf(".")), name.slice(name.lastIndexOf(".") + 1)];
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${dir}${escaped}(?:\\.[\\w-]+)?\\.${ext}`));
  if (!match) throw new Error(`${name} is no longer referenced by ${site}`);
  return new URL(match[0], site).href;
}

// ---------------------------------------------------------------- hatom.com

const HATOM_TEXTURES = [
  "planets/planet_01.jpg",
  "planets/planet_02.jpg",
  "planets/planet_03.jpg",
  "planets/planet_04.jpg",
  "paint-swirl.jpg",
];

/** `sprite={ClickUI:[0,1016.66],…}` -> { ClickUI: [0, 1016.66], … } */
function parseSprite(js, firstKey) {
  const body = js.match(new RegExp(`\\{(${firstKey}:\\[[^}]+)\\}`))?.[1];
  if (!body) throw new Error(`hatom: sprite starting with ${firstKey} not found`);
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\[([\d.e+-]+),([\d.e+-]+)\]/g)].map(([, key, start, length]) => [
      key,
      [Number(start), Math.round(Number(length))],
    ]),
  );
}

async function syncHatom() {
  const site = SITES.hatom;
  const { css, js } = await loadSite(site, /\/assets\/[\w-]+\.(?:css|js)/g);
  const faces = fontFaces(css, `${site}/assets/`);
  await syncUrl(findFace(faces, "OCMikola", "400", "normal", site), "app/fonts/oc-mikola-400.woff2");
  await syncUrl(findFace(faces, "OCMikola", "500", "normal", site), "app/fonts/oc-mikola-500.woff2");

  for (const texture of HATOM_TEXTURES) {
    const url = findHashed(js, "/webgl/home/textures/", texture, site);
    await syncUrl(url, `public/hatom/${path.basename(texture)}`);
  }

  // The site's Howler sound banks: UI effects and the egg's rollover chimes.
  const banks = {
    sfx: { file: findHashed(js, "/audio/global/", "sfx.mp3", site), sprite: parseSprite(js, "ClickUI") },
    rollovers: {
      file: findHashed(js, "/audio/global/", "rollovers.mp3", site),
      sprite: parseSprite(js, "egg_rollover_1"),
    },
  };
  const manifest = {};
  for (const [name, bank] of Object.entries(banks)) {
    const local = `/hatom/audio/${path.basename(bank.file)}`;
    await syncUrl(bank.file, `public${local}`);
    manifest[name] = { src: local, sprite: bank.sprite };
  }

  // Its music: the egg theme at the top of the page, the griffin theme once
  // the egg has burst, and the one-off cues played at scroll moments.
  const tracks = {
    themes: { egg: "theme_1.mp3", griffin: "theme_2.mp3" },
    cues: {
      eggToGriffin: "egg_to_griffin_transition.mp3",
      griffinArmor: "griffin_armor_transition.mp3",
      planetReveal: "planet_reveal.mp3",
      slowBuildup: "slow_buildup.mp3",
    },
  };
  for (const [group, files] of Object.entries(tracks)) {
    manifest[group] = {};
    for (const [key, file] of Object.entries(files)) {
      const url = findHashed(js, "/audio/global/", file, site);
      const local = `/hatom/audio/${path.basename(url)}`;
      await syncUrl(url, `public${local}`);
      manifest[group][key] = local;
    }
  }
  await syncFile("app/data/sfx.json", `${JSON.stringify(manifest, null, 2)}\n`, `${site} (Howler sprites and music)`);
}

// ----------------------------------------------------------------- zk.email

const ZKEMAIL_IMAGES = [
  "noise.jpg",
  "DKIMIcon.png",
  "RegexIcon.png",
  "ZKCircuitsIcon.webp",
  "Recovery.png",
  "WhistleblowLogo.png",
  "MarqueeSeparator.svg",
  "BlueDiamondOutlined.svg",
];

/** Chunks webpack loads on demand (`__webpack_require__.e(87)`), which the HTML doesn't link. */
async function loadLazyChunks(site, js) {
  const hash = js.match(/"static\/chunks\/"\+e\+"\.([0-9a-f]+)\.js"/)?.[1];
  if (!hash) return "";
  const ids = new Set([...js.matchAll(/\.e\((\d+)\)/g)].map(([, id]) => id));
  let text = "";
  for (const id of ids) text += await downloadText(`${site}/_next/static/chunks/${id}.${hash}.js`);
  return text;
}

async function syncZkEmail() {
  const site = SITES.zkemail;
  const { html, css, js } = await loadSite(site, /\/_next\/static\/(?:css|chunks)\/[^"']+\.(?:css|js)/g);
  const faces = fontFaces(css, site);
  await syncUrl(findFace(faces, "Newsreader", "200 800", "normal", site), "app/fonts/newsreader-latin.woff2");
  await syncUrl(findFace(faces, "Fustat", "200 800", "normal", site), "app/fonts/fustat-latin.woff2");
  const source = html + css + js + (await loadLazyChunks(site, js));
  for (const name of ZKEMAIL_IMAGES) {
    await syncUrl(findHashed(source, "/assets/", name, site), `public/zkemail/${name}`);
  }
}

// ----------------------------------------------------------------- taceo.io

const TACEO_IMAGES = [
  "merces-halftone-portrait-front.webp",
  "merces-halftone-portrait-back.webp",
  "merces-mainnet-announcement.svg",
  "dotted-divider.svg",
];

async function syncTaceo() {
  const site = SITES.taceo;
  const { html, css } = await loadSite(site, /\/_astro\/[\w.-]+\.css/g);
  const faces = fontFaces(css + html, site);
  const family = /^PP Neue Montreal-[0-9a-f]+$/;
  for (const weight of ["300", "400", "500"]) {
    await syncUrl(findFace(faces, family, weight, "normal", site), `app/fonts/neue-montreal-${weight}.woff2`);
  }
  for (const name of TACEO_IMAGES) {
    // Astro names files <name>.<hash>[_<hash>].<ext>
    const [stem, ext] = name.split(".");
    const match = (html + css).match(new RegExp(`/_astro/${stem}\\.[\\w-]+\\.${ext}`));
    if (!match) throw new Error(`${name} is no longer referenced by ${site}`);
    await syncUrl(new URL(match[0], site).href, `public/taceo/${name}`);
  }
}

// ------------------------------------------------------------ aztec.network

const AZTEC_IMAGES = ["header-bg.webp", "news-bg.webp", "sandbox-bg.webp", "projects.webp", "squares-purple.svg"];

/** "…/6847514dc37a9e8cfe8a66b8_header-bg.webp" -> "header-bg.webp" */
const webflowName = (url) =>
  decodeURIComponent(url.split("/").pop())
    .replace(/^[0-9a-f]{24}_/, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-");

async function syncAztec() {
  const site = SITES.aztec;
  const html = await downloadText(site);
  const $ = cheerio.load(html);
  const css = (await downloadText($('link[rel="stylesheet"]').attr("href"))) + $("style").text();
  const faces = fontFaces(css, site);
  await syncUrl(findFace(faces, "Arizona Serif", "300", "normal", site), "app/fonts/arizona-serif-300.woff2");
  await syncUrl(findFace(faces, "Arizona Serif Italic", "300", "italic", site), "app/fonts/arizona-serif-italic-300.woff2");
  await syncUrl(findFace(faces, "MD Thermochrome", "400", "normal", site), "app/fonts/md-thermochrome-400.woff2");

  const urls = new Map();
  for (const url of (html + css).match(/https:\/\/cdn\.prod\.website-files\.com\/[^"'()\s]+/g)) {
    urls.set(webflowName(url), url);
  }
  for (const name of AZTEC_IMAGES) {
    if (!urls.has(name)) throw new Error(`${name} is no longer referenced by ${site}`);
    await syncUrl(urls.get(name), `public/aztec/${name}`);
  }
}

// ------------------------------------------------------------- dymension.xyz

const DYMENSION_IMAGES = [
  "rollapp1.png",
  "rollapp2.png",
  "rollapp3.png",
  "rollapp4.png",
  "rollapp5.png",
  "rollapp6.png",
  "rollapp-gradient.png",
  "autonomy-illustration.png",
  "performance-illustration.png",
  "liquidity-illustration.png",
  "footer-background1.png",
];

async function syncDymension() {
  const site = SITES.dymension;
  const { html, css, js } = await loadSite(site, /\/_next\/static\/(?:css|chunks)\/[^"']+\.(?:css|js)/g);
  const source = html + css + js;
  const media = (name) => findHashed(source, "/_next/static/media/", name, site);
  await syncUrl(media("TWKEverett-Medium.woff2"), "app/fonts/everett-500.woff2");
  for (const name of DYMENSION_IMAGES) await syncUrl(media(name), `public/dymension/${name}`);
}

// ------------------------------------------------------------------ derived

/**
 * Turns aztec's village painting into the pen drawing the enter screen shows
 * (hatom's loader draws its scene as line art before the click reveals it):
 * Sobel edge magnitude of the softened greyscale image, as dark lines on white.
 */
async function deriveSketch() {
  const source = "public/aztec/news-bg.webp";
  const base = sharp(path.join(ROOT, source)).greyscale().blur(1.4);
  const sobel = (kernel) =>
    base.clone().convolve({ width: 3, height: 3, kernel, scale: 1, offset: 128 }).raw().toBuffer({ resolveWithObject: true });
  const { data: gx, info } = await sobel([-1, 0, 1, -2, 0, 2, -1, 0, 1]);
  const { data: gy } = await sobel([-1, -2, -1, 0, 0, 0, 1, 2, 1]);
  const lines = Buffer.alloc(gx.length);
  for (let i = 0; i < gx.length; i++) {
    const magnitude = Math.hypot(gx[i] - 128, gy[i] - 128) / 180;
    lines[i] = 255 - Math.round(255 * Math.min(1, magnitude * 1.8) ** 1.6);
  }
  const sketch = await sharp(lines, { raw: { width: info.width, height: info.height, channels: 1 } })
    .webp({ quality: 85 })
    .toBuffer();
  await syncFile("public/aztec/news-bg-sketch.webp", sketch, `derived from ${source}`);
}

await syncHatom();
await syncZkEmail();
await syncTaceo();
await syncAztec();
await syncDymension();
/**
 * The same painting as taceo prints its artwork: a 45° halftone of mint dots
 * on taceo's deep green, dot size following the brightness. This is the
 * "private" version of the scene that the hero's slab and cursor lens reveal.
 * Rendered at twice the painting's size so the dots stay crisp.
 */
async function deriveHalftone() {
  const source = "public/aztec/news-bg.webp";
  const SCALE = 2;
  const CELL = 14;
  const [ink, dot] = [
    [0x00, 0x2f, 0x24],
    [0x00, 0xff, 0xc1],
  ];
  const { width, height } = await sharp(path.join(ROOT, source)).metadata();
  const [w, h] = [width * SCALE, height * SCALE];
  const { data: luma } = await sharp(path.join(ROOT, source))
    .resize(w, h)
    .greyscale()
    .blur(CELL / 3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [cos, sin] = [Math.SQRT1_2, Math.SQRT1_2];
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Nearest cell centre on the rotated screen, back in image space.
      const u = Math.round((x * cos + y * sin) / CELL);
      const v = Math.round((-x * sin + y * cos) / CELL);
      const [cx, cy] = [(u * cos - v * sin) * CELL, (u * sin + v * cos) * CELL];
      const sx = Math.min(w - 1, Math.max(0, Math.round(cx)));
      const sy = Math.min(h - 1, Math.max(0, Math.round(cy)));
      const brightness = Math.min(1, Math.max(0, (luma[sy * w + sx] / 255 - 0.12) / 0.85));
      // Dot area follows brightness, capped short of touching so the deep green stays dominant.
      const radius = CELL * 0.42 * Math.sqrt(brightness);
      const coverage = Math.min(1, Math.max(0, radius - Math.hypot(x - cx, y - cy) + 0.5));
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = Math.round(ink[c] + (dot[c] - ink[c]) * coverage);
    }
  }
  // Two colours plus anti-aliasing steps: a small palette PNG keeps it light and exact.
  const halftone = await sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .png({ palette: true, colours: 16, effort: 10 })
    .toBuffer();
  await syncFile("public/aztec/news-bg-halftone.png", halftone, `derived from ${source}`);
}

await deriveSketch();
await deriveHalftone();

if (CHECK) {
  console.log(allMatch ? "\nAll assets match the live sites." : "\nSome assets differ from the live sites.");
  process.exitCode = allMatch ? 0 : 1;
}
