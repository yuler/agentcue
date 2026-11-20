/**
 * Hero intro animation entry. Owns the play clock: plays only while the stage
 * is on screen, the tab is visible, and the pointer is not hovering it.
 * Respects prefers-reduced-motion by rendering one resolved frame.
 */
import { isMacPlatform } from "../../../../packages/agentcue/src/client/dom.ts";
import { getCurrentLang } from "../i18n.ts";
import { buildStage, measureAnchors, placeOverlayStatics, WORLD_W } from "./stage.ts";
import {
  buildKeys,
  createTimeline,
  DURATION,
  REST_TIME,
  STEP_STARTS,
  STEP_STILLS,
  stepCopy,
  type Timeline,
} from "./timeline.ts";

export function initIntro() {
  const mount = document.getElementById("intro");
  if (!mount) return;

  const mac = isMacPlatform();
  const refs = buildStage(mount, stepCopy(mac));
  buildKeys(refs, mac);
  placeOverlayStatics(refs);

  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let fit = refs.frame.clientWidth / WORLD_W || 1;
  let t = STEP_STARTS[0];
  let inView = false;
  let hovering = false;
  let timeline: Timeline = createTimeline(refs, measureAnchors(refs));

  const render = () => timeline.render(t, fit, getCurrentLang());
  const shouldPlay = () => inView && !hovering && !document.hidden && !reducedQuery.matches;

  let rafId = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    t = (t + dt) % DURATION;
    render();
    rafId = shouldPlay() ? requestAnimationFrame(tick) : 0;
  };
  const sync = () => {
    if (shouldPlay()) {
      if (!rafId) {
        last = 0;
        rafId = requestAnimationFrame(tick);
      }
    } else {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (reducedQuery.matches && !refs.root.dataset.jumped) t = REST_TIME;
      render();
    }
  };

  new ResizeObserver(() => {
    fit = refs.frame.clientWidth / WORLD_W || 1;
    render();
  }).observe(refs.frame);

  new IntersectionObserver(
    (entries) => {
      inView = entries.some((e) => e.isIntersecting);
      sync();
    },
    { threshold: 0.25 },
  ).observe(refs.frame);

  refs.frame.addEventListener("pointerenter", () => {
    hovering = true;
    sync();
  });
  refs.frame.addEventListener("pointerleave", () => {
    hovering = false;
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  reducedQuery.addEventListener("change", () => {
    delete refs.root.dataset.jumped;
    sync();
  });

  refs.steps.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      t = shouldPlay() ? STEP_STARTS[i] : STEP_STILLS[i];
      refs.root.dataset.jumped = "1";
      last = 0;
      render();
    });
  });
  refs.tryLink.addEventListener("click", () => {
    document.querySelector(".sandbox-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Re-render on language / theme switches while paused.
  new MutationObserver(render).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang", "data-theme"],
  });

  // Web fonts can shift toolbar widths; re-measure anchors once they settle.
  document.fonts?.ready.then(() => {
    timeline = createTimeline(refs, measureAnchors(refs));
    render();
  });

  if (reducedQuery.matches) t = REST_TIME;
  render();
}
