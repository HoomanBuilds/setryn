export const VIEW_W = 1000;
export const VIEW_H = 320;

export function bounds(values: number[], padRatio = 0.12): { min: number; max: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  return { min: lo - span * padRatio, max: hi + span * padRatio };
}

export function ticks(min: number, max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push(min + ((max - min) * i) / count);
  return out;
}

export function makeScale(min: number, max: number, size: number, invert = false) {
  const span = max - min || 1;
  return (value: number) => {
    const ratio = (value - min) / span;
    return invert ? size - ratio * size : ratio * size;
  };
}

export function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

export function stepPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L${points[i].x.toFixed(2)} ${points[i - 1].y.toFixed(2)}`;
    d += ` L${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}
