/** Time-sampled keyframe tracks and the virtual camera for the hero intro. */
import { WORLD_H, WORLD_W } from "./stage.ts";

export type Key = [t: number, ...values: number[]];

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export const easeInOut = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

/** 0→1 progress of t through [a, b], eased. */
export function progress(t: number, a: number, b: number, ease = easeInOut): number {
  if (b <= a) return t >= b ? 1 : 0;
  return ease(clamp((t - a) / (b - a), 0, 1));
}

/** Sample a sorted keyframe track at time t with eased interpolation between keys. */
export function sample(track: Key[], t: number): number[] {
  if (t <= track[0][0]) return track[0].slice(1);
  for (let i = 1; i < track.length; i++) {
    const [t1, ...v1] = track[i];
    if (t <= t1) {
      const [t0, ...v0] = track[i - 1];
      const p = progress(t, t0, t1);
      return v0.map((v, j) => v + (v1[j] - v) * p);
    }
  }
  return track[track.length - 1].slice(1);
}

/**
 * Apply camera centered on world point (cx, cy) at zoom z. The view is clamped
 * so it never shows outside the world bounds. `fit` maps world px to frame px.
 */
export function applyCamera(world: HTMLElement, fit: number, cx: number, cy: number, z: number) {
  const halfW = WORLD_W / (2 * z);
  const halfH = WORLD_H / (2 * z);
  const x = clamp(cx, halfW, WORLD_W - halfW);
  const y = clamp(cy, halfH, WORLD_H - halfH);
  const tx = fit * (WORLD_W / 2 - x * z);
  const ty = fit * (WORLD_H / 2 - y * z);
  world.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${(fit * z).toFixed(4)})`;
}
