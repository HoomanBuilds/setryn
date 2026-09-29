import { createNoise3D } from "simplex-noise";

/**
 * Ink blobs as SVG path data, for `clip-path: path()`. hatom's enter screen
 * reveals its scene through an ink stain that follows the cursor and bursts
 * open on click; these paths recreate that in 2D.
 */
const noise = createNoise3D();

export type InkOptions = {
  /** Soft wobble of the outline, as a fraction of the radius. */
  wobble?: number;
  /** Length of the splatter spikes, as a fraction of the radius. */
  spikes?: number;
  /** Seed so separate blobs don't move in step. */
  seed?: number;
  points?: number;
};

type Point = [number, number];

/** Smooth closed curve through `points` (Catmull-Rom converted to cubic Béziers). */
function closedCurve(points: Point[]) {
  const n = points.length;
  const f = (value: number) => value.toFixed(1);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    d +=
      `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** An ink blob centred on (cx, cy); `time` animates the outline. */
export function inkBlob(cx: number, cy: number, radius: number, time: number, options: InkOptions = {}) {
  const { wobble = 0.12, spikes = 0, seed = 0, points = 72 } = options;
  const outline: Point[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    let r = radius * (1 + wobble * noise(cos * 1.3 + seed, sin * 1.3, time));
    if (spikes) r += radius * spikes * Math.max(0, noise(cos * 5, sin * 5 + seed, seed + time * 0.15)) ** 2.2;
    outline.push([cx + cos * r, cy + sin * r]);
  }
  return closedCurve(outline);
}

/** Small splash droplets scattered just outside a blob of `radius`. */
export function inkDroplets(cx: number, cy: number, radius: number, count: number, seed: number) {
  let d = "";
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + noise(i, seed, 0.5) * 0.6;
    const distance = radius * (1.35 + 0.4 * Math.abs(noise(i, seed, 1.5)));
    const size = Math.max(1, radius * (0.025 + 0.03 * Math.abs(noise(i, seed, 2.5))));
    const [x, y] = [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance];
    d += `M${(x - size).toFixed(1)} ${y.toFixed(1)}a${size.toFixed(1)} ${size.toFixed(1)} 0 1 0 ${(2 * size).toFixed(1)} 0a${size.toFixed(1)} ${size.toFixed(1)} 0 1 0 ${(-2 * size).toFixed(1)} 0`;
  }
  return d;
}

/** A clip path covering a `width`×`height` box with `holes` cut out of it. */
export function withHoles(width: number, height: number, holes: string) {
  return `path(evenodd, "M0 0H${width}V${height}H0Z${holes}")`;
}
