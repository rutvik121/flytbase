"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import NestGenLogo from "./NestGenLogo";

/**
 * One continuous pinned journey. The scroll is the camera.
 *
 * The timeline is measured in "units" rather than a 0..1 progress fraction, so
 * appending a new act never re-times the acts before it: UNIT_VH fixes how much
 * physical scrolling one unit costs, and TOTAL_UNITS just gets longer.
 */
const UNIT_VH = 9;
const TOTAL_UNITS = 376;

/**
 * The journey is a chain of clips, each generated from the previous clip's final
 * frame as its start keyframe. Handoffs are therefore crossfades between two
 * near-identical frames: the picture never cuts, and no clip is ever scaled or
 * boxed. Clips are laid end to end in one continuous camera move.
 */
type Clip = {
  key: string;
  src: string;
  poster: string;
  /** unit range over which the clip is scrubbed */
  from: number;
  to: number;
  /** crossfade window; omitted for the opening clip */
  fadeFrom?: number;
  fadeTo?: number;
  /**
   * Optional second pass that scrubs the clip backwards, 1 → 0. Used to retreat
   * the camera back out of a location without generating new footage.
   */
  reverseFrom?: number;
  reverseTo?: number;
  /** Optional fade-out window, uncovering the clip stacked beneath. */
  outFrom?: number;
  outTo?: number;
};

const CLIPS: Clip[] = [
  {
    key: "sqm",
    src: "/media/sqm-sequence.mp4",
    poster: "/media/sqm-poster.jpg",
    from: 0,
    to: 68,
  },
  {
    key: "world",
    src: "/media/world-pullout.mp4",
    poster: "/media/world-pullout-poster.jpg",
    from: 110,
    to: 150,
    fadeFrom: 106,
    fadeTo: 110,
  },
  {
    key: "descent",
    src: "/media/city-descent.mp4",
    poster: "/media/city-descent-poster.jpg",
    from: 178,
    to: 200,
    fadeFrom: 174,
    fadeTo: 178,
    // ACT IV: the same descent run backwards lifts the camera back out of the
    // city. Its frame 0 is the world clip's final frame, so fading it out at
    // frac 0 lands exactly on the global view again.
    reverseFrom: 267,
    reverseTo: 282,
    outFrom: 282,
    outTo: 287,
  },
  {
    key: "safety",
    src: "/media/public-safety.mp4",
    poster: "/media/public-safety-poster.jpg",
    from: 204,
    to: 236,
    fadeFrom: 200,
    fadeTo: 204,
    outFrom: 265,
    outTo: 270,
  },
];

/** How many units before its crossfade a clip starts downloading. */
const PRELOAD_LEAD = 45;

/**
 * Under prefers-reduced-motion every clip parks on this fraction of its own
 * duration instead of being scrubbed. Mid-clip rather than frame 0: the first
 * frame of a continuing shot is the least representative one.
 */
const REDUCED_MOTION_FRAME = 0.5;

/**
 * Where the seep sits in the SQM clip's *settled* frame, as a percentage of the
 * video's own 16:9 content box — not the viewport.
 */
const MARKER = { x: 44, y: 75 };
const VIDEO_ASPECT = "16 / 9";

type Location = {
  label: string;
  sub?: string;
  x: number;
  y: number;
  at: number;
  /** the mine we just left */
  origin?: boolean;
  /** where the camera travels next */
  destination?: boolean;
};

const LOCATIONS: Location[] = [
  { label: "Mining", sub: "SQM · Chile", x: 47, y: 62, at: 118, origin: true },
  { label: "Energy", x: 25, y: 56, at: 125 },
  { label: "Ports", x: 72, y: 54, at: 131 },
  { label: "Public Safety", x: 17, y: 75, at: 137, destination: true },
  { label: "Transportation", x: 83, y: 70, at: 142 },
  { label: "Construction", x: 57, y: 83, at: 147 },
];

const BEAT = {
  // ACT I — the SQM story
  heroOut: 4,
  kicker: 14,
  problemIn: 17,
  problemOut: 32,
  searchIn: 38,
  searchOut: 54,
  droneLabels: 44,
  droneLabelsOut: 62,
  markerIn: 70,
  markerOut: 84,
  dim: 80,
  metric: 83,
  impact: 88,
  outcomeOut: 92,
  darken: 92,
  bridgeIn: 94,
  hookIn: 97,
  bridgeOut: 103,

  // ACT II — the world opens up
  lighten: 110,
  headlineIn: 152,
  sublineIn: 159,
  worldCopyOut: 164,

  // ACT III — the camera picks a destination and travels to it
  activate: 167,
  othersDim: 166,
  locationsOut: 174,
  emergencyIn: 208,
  emergencyOut: 215,
  dispatchIn: 219,
  dispatchOut: 228,
  // 228-240 carries no copy at all: the widening gap between the drone and the
  // patrol car is the argument, so nothing competes with it.
  arrivesIn: 240,
  arrivesOut: 262,

  // ACT IV — the camera retreats and the pattern becomes the point
  industriesIn: 288,
  realizationIn: 296,
  realizationSubIn: 302,
  industriesOut: 310,

  // ACT V — the practical question
  questionIn: 314,
  challengesIn: 320,
  challengesOut: 332,

  // ACT VI — NestGen is the answer. The mark leads; the words follow it.
  finalDark: 332,
  logoIn: 337,
  seeHowIn: 343,
  nestgenNameIn: 347,
  eventMetaIn: 351,
  revealOut: 358,

  // ACT VII — registration
  ctaHeadIn: 362,
  ctaSubIn: 367,
  ctaButtonIn: 371,
} as const;

/** The practical problems the stories leave behind. Editorial, not cards. */
const CHALLENGES = ["ROI", "Scaling", "Operations", "Regulation", "Hardware", "AI"];

/** In-page jump targets, reusing the same BEAT units the timeline is staged on. */
const SECTIONS = [
  { label: "Mining", unit: BEAT.kicker },
  { label: "Industries", unit: BEAT.headlineIn },
  { label: "Public Safety", unit: BEAT.emergencyIn },
  { label: "NestGen '26", unit: BEAT.logoIn },
] as const;

/**
 * Eased seek loop: scroll sets a target, the decoder sets the pace.
 *
 * Scroll stores a 0..1 fraction rather than seconds, and duration is resolved
 * here — inside the readyState guard, where it is known to be valid. Guessing a
 * duration before metadata lands would silently clamp the scrub to the wrong
 * length and make the tail of a clip unreachable.
 */
function makeScrubber(video: HTMLVideoElement) {
  const state = { frac: 0 };
  let applied = -1;
  const tick = () => {
    if (video.readyState < 2 || video.seeking) return;
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const t = state.frac * dur;
    const next = applied < 0 ? t : applied + (t - applied) * 0.16;
    const settled = Math.abs(t - next) < 0.004 ? t : next;
    if (Math.abs(settled - applied) > 0.008) {
      applied = settled;
      try {
        video.currentTime = settled;
      } catch {
        /* seek can throw mid-load; the next tick retries */
      }
    }
  };
  return { state, tick };
}

export default function SqmCinematic() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const scrimRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);

  const heroRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const kickerRef = useRef<HTMLDivElement>(null);

  const problemRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const droneMetaRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);

  const outcomeRef = useRef<HTMLDivElement>(null);
  const metricRef = useRef<HTMLDivElement>(null);
  const impactRef = useRef<HTMLDivElement>(null);

  const bridgeRef = useRef<HTMLDivElement>(null);
  const hookRef = useRef<HTMLDivElement>(null);

  const headlineRef = useRef<HTMLDivElement>(null);
  const sublineRef = useRef<HTMLDivElement>(null);
  const locRefs = useRef<(HTMLDivElement | null)[]>([]);
  const ringRef = useRef<HTMLSpanElement>(null);
  const destLabelRef = useRef<HTMLSpanElement>(null);

  const emergencyRef = useRef<HTMLDivElement>(null);
  const dispatchRef = useRef<HTMLDivElement>(null);
  const arrivesRef = useRef<HTMLDivElement>(null);
  const psKickerRef = useRef<HTMLDivElement>(null);

  const realizationRef = useRef<HTMLDivElement>(null);
  const realizationSubRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const challengesRef = useRef<HTMLDivElement>(null);
  const challengeItemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const seeHowRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const nestgenNameRef = useRef<HTMLDivElement>(null);
  const eventMetaRef = useRef<HTMLDivElement>(null);
  const ctaHeadRef = useRef<HTMLDivElement>(null);
  const ctaSubRef = useRef<HTMLDivElement>(null);
  const ctaButtonRef = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const videos = videoRefs.current;
    const first = videos[0];
    if (!root || !first || videos.some((v) => !v)) return;

    gsap.registerPlugin(ScrollTrigger);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let ctx: gsap.Context | undefined;
    let tickerFn: (() => void) | undefined;
    let cancelled = false;

    const build = () => {
      if (cancelled) return;
      setReady(true);

      const scrubbers = videos.map((v) => makeScrubber(v as HTMLVideoElement));
      const requested = CLIPS.map((_, i) => i === 0);

      ctx = gsap.context(() => {
        const locs = locRefs.current.filter(Boolean) as HTMLDivElement[];

        gsap.set(
          [
            kickerRef.current,
            problemRef.current,
            searchRef.current,
            droneMetaRef.current,
            impactRef.current,
            bridgeRef.current,
            hookRef.current,
            headlineRef.current,
            sublineRef.current,
            emergencyRef.current,
            dispatchRef.current,
            arrivesRef.current,
            psKickerRef.current,
            realizationRef.current,
            realizationSubRef.current,
            questionRef.current,
            seeHowRef.current,
            logoRef.current,
            nestgenNameRef.current,
            eventMetaRef.current,
            ctaHeadRef.current,
            ctaSubRef.current,
            ctaButtonRef.current,
            ...locs,
          ],
          { opacity: 0, y: 26 }
        );
        gsap.set(challengeItemRefs.current.filter(Boolean), { opacity: 0, y: 14 });
        gsap.set(metricRef.current, { opacity: 0, y: 18, scale: 0.96 });
        gsap.set(markerRef.current, { opacity: 0, scale: 0.88 });
        gsap.set(ringRef.current, { opacity: 0 });
        // Pin an explicit rgb start: Tailwind's computed oklab() start colour
        // makes GSAP interpolate through garbage (a red flash) on the way to
        // the accent.
        gsap.set(destLabelRef.current, { color: "rgba(242,240,234,0.7)" });
        videos.forEach((v, i) => i > 0 && gsap.set(v as HTMLVideoElement, { opacity: 0 }));

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: root,
            start: "top top",
            end: "bottom bottom",
            scrub: reduced ? true : 0.8,
            pin: stageRef.current,
            anticipatePin: 1,
            onUpdate: (self) => {
              const unit = self.progress * TOTAL_UNITS;

              CLIPS.forEach((clip, i) => {
                const v = videos[i] as HTMLVideoElement;
                let frac = gsap.utils.clamp(
                  0,
                  1,
                  (unit - clip.from) / (clip.to - clip.from)
                );
                // A reverse pass takes over once its window opens, walking the
                // same footage back from 1 to 0.
                if (clip.reverseFrom != null && clip.reverseTo != null && unit > clip.reverseFrom) {
                  const back = gsap.utils.clamp(
                    0,
                    1,
                    (unit - clip.reverseFrom) / (clip.reverseTo - clip.reverseFrom)
                  );
                  frac = 1 - back;
                }
                // Under prefers-reduced-motion the camera never flies: each clip
                // is pinned to a representative still and the journey becomes a
                // cross-faded sequence of frames instead of continuous motion.
                scrubbers[i].state.frac = reduced ? REDUCED_MOTION_FRAME : frac;

                if (!requested[i] && unit > (clip.fadeFrom ?? 0) - PRELOAD_LEAD) {
                  requested[i] = true;
                  v.preload = "auto";
                  v.load();
                }
              });
            },
          },
        });

        // Lock the timeline to exactly TOTAL_UNITS. Without this its duration is
        // whenever the last tween happens to end, so ScrollTrigger would map
        // progress onto that instead and every "unit" position would silently
        // skew — including the video/text sync.
        tl.to({}, { duration: TOTAL_UNITS }, 0);

        // Crossfades between clips. Each incoming clip is still sitting on its
        // first frame — which is the outgoing clip's last frame — so nothing
        // moves during the swap and it reads as one continuous shot.
        CLIPS.forEach((clip, i) => {
          const v = videos[i] as HTMLVideoElement;
          if (i > 0 && clip.fadeFrom != null && clip.fadeTo != null) {
            tl.to(v, { opacity: 1, duration: clip.fadeTo - clip.fadeFrom }, clip.fadeFrom);
          }
          // Fading a clip out uncovers the one stacked beneath it, which is
          // sitting on a matching frame — so the retreat is also seamless.
          if (clip.outFrom != null && clip.outTo != null) {
            tl.to(v, { opacity: 0, duration: clip.outTo - clip.outFrom }, clip.outFrom);
          }
        });

        // ── ACT I — the SQM story ──────────────────────────────────────────
        tl.to(heroRef.current, { opacity: 0, y: -40, duration: 8 }, BEAT.heroOut);
        tl.to(cueRef.current, { opacity: 0, duration: 5 }, 1);

        tl.to(kickerRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.kicker);
        tl.to(problemRef.current, { opacity: 1, y: 0, duration: 8 }, BEAT.problemIn);
        tl.to(problemRef.current, { opacity: 0, y: -24, duration: 6 }, BEAT.problemOut);

        tl.to(searchRef.current, { opacity: 1, y: 0, duration: 8 }, BEAT.searchIn);
        tl.to(droneMetaRef.current, { opacity: 1, y: 0, duration: 7 }, BEAT.droneLabels);
        tl.to(searchRef.current, { opacity: 0, y: -24, duration: 6 }, BEAT.searchOut);
        tl.to(droneMetaRef.current, { opacity: 0, duration: 6 }, BEAT.droneLabelsOut);

        tl.to(markerRef.current, { opacity: 1, scale: 1, duration: 7 }, BEAT.markerIn);
        tl.to(kickerRef.current, { opacity: 0, duration: 5 }, BEAT.dim);
        tl.to(markerRef.current, { opacity: 0, scale: 1.3, duration: 7 }, BEAT.markerOut);

        tl.to(scrimRef.current, { opacity: 0.72, duration: 10 }, BEAT.dim);
        tl.to(vignetteRef.current, { opacity: 1, duration: 10 }, BEAT.dim);
        tl.to(metricRef.current, { opacity: 1, y: 0, scale: 1, duration: 8 }, BEAT.metric);
        tl.to(impactRef.current, { opacity: 1, y: 0, duration: 7 }, BEAT.impact);

        tl.to(outcomeRef.current, { opacity: 0, y: -20, duration: 5 }, BEAT.outcomeOut);
        tl.to(scrimRef.current, { opacity: 0.85, duration: 6 }, BEAT.darken);
        tl.to(bridgeRef.current, { opacity: 1, y: 0, duration: 5 }, BEAT.bridgeIn);
        tl.to(hookRef.current, { opacity: 1, y: 0, duration: 5 }, BEAT.hookIn);
        tl.to(
          [bridgeRef.current, hookRef.current],
          { opacity: 0, y: -18, duration: 4 },
          BEAT.bridgeOut
        );

        // ── ACT II — the world opens up ────────────────────────────────────
        tl.to(scrimRef.current, { opacity: 0.14, duration: 16 }, BEAT.lighten);
        tl.to(vignetteRef.current, { opacity: 0.45, duration: 16 }, BEAT.lighten);

        LOCATIONS.forEach((loc, i) => {
          const el = locRefs.current[i];
          if (el) tl.to(el, { opacity: 1, y: 0, duration: 6 }, loc.at);
        });

        tl.to(headlineRef.current, { opacity: 1, y: 0, duration: 7 }, BEAT.headlineIn);
        tl.to(sublineRef.current, { opacity: 1, y: 0, duration: 7 }, BEAT.sublineIn);
        tl.to(
          [headlineRef.current, sublineRef.current],
          { opacity: 0, y: -18, duration: 5 },
          BEAT.worldCopyOut
        );

        // ── ACT III — a destination is chosen, the camera travels ──────────
        const dimmed = locs.filter((_, i) => !LOCATIONS[i].destination);
        tl.to(dimmed, { opacity: 0.18, duration: 5 }, BEAT.othersDim);
        tl.to(ringRef.current, { opacity: 1, duration: 5 }, BEAT.activate);
        // literal rather than var(--accent-blue): GSAP can't interpolate a CSS
        // var. Must be kept in sync with --accent-blue in globals.css.
        tl.to(destLabelRef.current, { color: "#4d82ff", duration: 5 }, BEAT.activate);
        tl.to(locs, { opacity: 0, duration: 6 }, BEAT.locationsOut);
        tl.to(ringRef.current, { opacity: 0, duration: 6 }, BEAT.locationsOut);

        // descent lands in the city; darkness stays light so the streets read
        tl.to(scrimRef.current, { opacity: 0.35, duration: 12 }, BEAT.locationsOut);

        tl.to(psKickerRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.emergencyIn - 4);
        tl.to(emergencyRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.emergencyIn);
        tl.to(emergencyRef.current, { opacity: 0, y: -20, duration: 5 }, BEAT.emergencyOut);
        tl.to(dispatchRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.dispatchIn);
        tl.to(dispatchRef.current, { opacity: 0, y: -20, duration: 5 }, BEAT.dispatchOut);
        tl.to(psKickerRef.current, { opacity: 0, duration: 5 }, BEAT.dispatchOut);

        // the payoff — held, and the strongest line of the act
        tl.to(vignetteRef.current, { opacity: 0.8, duration: 8 }, BEAT.arrivesIn - 4);
        tl.to(arrivesRef.current, { opacity: 1, y: 0, duration: 7 }, BEAT.arrivesIn);
        tl.to(arrivesRef.current, { opacity: 0, y: -18, duration: 5 }, BEAT.arrivesOut);

        // ── ACT IV — the camera retreats; the pattern is the point ─────────
        // The clip fades/reverses are declared with CLIPS above. Here the world
        // simply comes back, with both visited locations already in accent.
        tl.to(vignetteRef.current, { opacity: 0.45, duration: 12 }, BEAT.arrivesOut);
        tl.to(scrimRef.current, { opacity: 0.2, duration: 12 }, BEAT.arrivesOut);
        tl.to(locs, { opacity: 1, y: 0, duration: 5, stagger: 1.4 }, BEAT.industriesIn);
        tl.to(realizationRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.realizationIn);
        tl.to(
          realizationSubRef.current,
          { opacity: 1, y: 0, duration: 6 },
          BEAT.realizationSubIn
        );
        tl.to(
          [locs, realizationRef.current, realizationSubRef.current].flat(),
          { opacity: 0, y: -16, duration: 5 },
          BEAT.industriesOut
        );

        // ── ACT V — the practical question ─────────────────────────────────
        // The world dims steadily from here to the end, so no stretch of the
        // finale sits on a frozen picture.
        tl.to(scrimRef.current, { opacity: 0.6, duration: 14 }, BEAT.questionIn);
        tl.to(questionRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.questionIn);
        tl.to(
          challengeItemRefs.current.filter(Boolean),
          { opacity: 1, y: 0, duration: 4, stagger: 1.4 },
          BEAT.challengesIn
        );
        tl.to(
          [questionRef.current, ...challengeItemRefs.current.filter(Boolean)],
          { opacity: 0, y: -14, duration: 5 },
          BEAT.challengesOut
        );

        // ── ACT VI — NestGen is the answer ─────────────────────────────────
        tl.to(scrimRef.current, { opacity: 0.93, duration: 10 }, BEAT.finalDark);
        // Restrained on purpose: the mark fades up and settles. No rotation, no
        // scale-through, no glitch — it should read as confident, not animated.
        tl.to(logoRef.current, { opacity: 1, y: 0, duration: 6 }, BEAT.logoIn);
        tl.to(seeHowRef.current, { opacity: 1, y: 0, duration: 5 }, BEAT.seeHowIn);
        tl.to(nestgenNameRef.current, { opacity: 1, y: 0, duration: 5 }, BEAT.nestgenNameIn);
        tl.to(eventMetaRef.current, { opacity: 1, y: 0, duration: 4 }, BEAT.eventMetaIn);
        tl.to(
          [
            logoRef.current,
            seeHowRef.current,
            nestgenNameRef.current,
            eventMetaRef.current,
          ],
          { opacity: 0, y: -16, duration: 4 },
          BEAT.revealOut
        );

        // ── ACT VII — registration ─────────────────────────────────────────
        tl.to(ctaHeadRef.current, { opacity: 1, y: 0, duration: 5 }, BEAT.ctaHeadIn);
        tl.to(ctaSubRef.current, { opacity: 1, y: 0, duration: 5 }, BEAT.ctaSubIn);
        // Only clickable once it is actually visible — otherwise an invisible
        // hit target sits mid-viewport for the whole journey.
        tl.to(
          ctaButtonRef.current,
          { opacity: 1, y: 0, pointerEvents: "auto", duration: 5 },
          BEAT.ctaButtonIn
        );
      }, root);

      tickerFn = () => scrubbers.forEach((s) => s.tick());
      gsap.ticker.add(tickerFn);

      ScrollTrigger.refresh();
    };

    videos.forEach((v) => v?.pause());

    if (first.readyState >= 1) {
      build();
    } else {
      first.addEventListener("loadedmetadata", build, { once: true });
    }

    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    const settle = setTimeout(refresh, 600);

    return () => {
      cancelled = true;
      clearTimeout(settle);
      first.removeEventListener("loadedmetadata", build);
      window.removeEventListener("load", refresh);
      if (tickerFn) gsap.ticker.remove(tickerFn);
      ctx?.revert();
    };
  }, []);

  const scrollToTop = (e: MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToRegister = (e: MouseEvent) => {
    // #register lives inside the pinned, aria-hidden stage, so a normal anchor
    // jump would either go nowhere or move focus into hidden content. Scroll
    // to the end of the journey instead, where the CTA is actually revealed.
    e.preventDefault();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  /**
   * Converts a BEAT "unit" into a scroll position, using the same
   * unit-to-progress mapping the ScrollTrigger itself resolves to at
   * runtime (progress = unit / TOTAL_UNITS, over the full scrollable range).
   * Lets nav links and the hero CTA jump straight into the timeline instead
   * of only ever being able to scroll to the very top or very bottom.
   */
  const scrollToUnit = (unit: number) => {
    const max = document.body.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (unit / TOTAL_UNITS) * max, behavior: "smooth" });
  };

  return (
    <div
      ref={rootRef}
      id="top"
      className="relative"
      style={{ height: `${TOTAL_UNITS * UNIT_VH + 100}vh` }}
    >
      {/*
        First focusable thing on the page. The journey is ~3,400vh of pinned
        scroll, so a keyboard user needs a way to reach the one action that
        matters without traversing all of it.
      */}
      <a href="#register" onClick={scrollToRegister} className="skip-link">
        Skip to registration
      </a>

      {/*
        Orientation anchor, not a navbar. role="banner" is explicit because this
        <header> renders inside <main> (page.tsx), and a header scoped to main
        does not expose the banner landmark on its own.
      */}
      <header
        role="banner"
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 md:py-6 lg:px-16"
      >
        {/* brand anchor — returns to the start of the journey */}
        <a
          href="#top"
          onClick={scrollToTop}
          aria-label="NestGen '26 — back to top"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <NestGenLogo
            height="clamp(26px, 2.4vw, 34px)"
            maxRenderedWidth={40}
            priority
          />
          <span className="font-mono-label text-[9px] uppercase text-foreground/60">
            by FlytBase
          </span>
        </a>

        {/* in-page navigation: jumps straight into the timeline at each act */}
        <nav aria-label="Story sections" className="hidden items-center gap-5 md:flex">
          {SECTIONS.map((s) => (
            // px/py are not decoration: they carry the hit target to the 24x24
            // CSS px minimum (WCAG 2.2 2.5.8). Bare 9px text is ~11px tall.
            <button
              key={s.label}
              type="button"
              onClick={() => scrollToUnit(s.unit)}
              className="font-mono-label px-1 py-2 text-[9px] uppercase text-foreground/60 transition-colors hover:text-accent-purple md:text-[10px]"
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/*
          No official registration URL was supplied, so this is visually complete
          but intentionally not pointed at an invented address.
          TODO: set href to the real registration URL.
        */}
        <a
          href="#register"
          onClick={scrollToRegister}
          className="font-mono-label rounded-full border border-white/15 px-4 py-2 text-[9px] uppercase text-foreground/80 transition-colors hover:border-accent-purple hover:text-accent-purple md:text-[10px]"
        >
          Register &rarr;
        </a>
      </header>

      {/*
        The pinned stage below is a choreographed visual sequence: the same
        copy is scattered across absolutely-positioned fragments that only
        make sense tied to scroll position and on-screen motion. Screen
        reader / non-visual users get this equivalent instead, in one
        normal reading-order pass, and the stage itself is aria-hidden.
      */}
      <div className="sr-only">
        <h1>What happens when machines stop waiting for humans?</h1>
        <p>Physical AI is already moving from experiments to real-world operations.</p>

        <h2>SQM &middot; Mining Operations</h2>
        <p>
          Some problems take days to find. Physical AI changes the search: an
          autonomous inspection unit located the leak in under 90 minutes. The
          system paid for itself in under a year. This isn&apos;t a concept —
          this is already being done.
        </p>

        <h2>This isn&apos;t one industry</h2>
        <p>
          Physical AI is already changing how mining, energy, ports, public
          safety, transportation, and construction operate.
        </p>

        <h2>Public Safety &middot; Drone as First Responder</h2>
        <p>
          An emergency. A drone is dispatched. It arrives before the patrol
          car.
        </p>

        <h2>Different industries. Same shift.</h2>
        <p>But how are they actually making this work?</p>
        <p>The practical questions: {CHALLENGES.join(", ")}.</p>

        <h2>NestGen &rsquo;26</h2>
        <p>See how they made it work.</p>
        <p>29 September 2026. Venue to be confirmed.</p>
        <p>
          The future isn&apos;t something to watch. It&apos;s something to
          build. See how the people already doing it made it work.
        </p>
        {/*
          Deliberately plain text, not a link: anything focusable in here is
          invisible to a sighted keyboard user and cannot reveal itself, because
          .sr-only clips its descendants. The reachable equivalents are the skip
          link at the top of the page and the Register link in the header.
        */}
        <p>Registration for NestGen &rsquo;26 is open.</p>
      </div>

      <section
        ref={stageRef}
        aria-hidden="true"
        className="relative h-screen w-full overflow-hidden bg-black"
      >
        {/* every clip full-bleed, never scaled, stacked in journey order */}
        {CLIPS.map((clip, i) => (
          <video
            key={clip.key}
            ref={(el) => {
              videoRefs.current[i] = el;
            }}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ zIndex: i, opacity: i === 0 ? 1 : 0 }}
            src={clip.src}
            poster={clip.poster}
            muted
            playsInline
            preload={i === 0 ? "auto" : "none"}
            disablePictureInPicture
            aria-hidden="true"
          />
        ))}

        {/*
          The mid-band used to be fully transparent, but most copy sits between
          26% and 58% — i.e. exactly there — so text contrast depended entirely
          on whatever the video happened to be showing. A floor of black/35
          keeps a predictable minimum behind the copy (WCAG 1.4.3).
        */}
        <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-b from-black/70 via-black/35 to-black/80" />
        <div ref={scrimRef} className="pointer-events-none absolute inset-0 z-20 bg-black opacity-0" />
        <div
          ref={vignetteRef}
          className="pointer-events-none absolute inset-0 z-20 opacity-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 100%)",
          }}
        />

        {!ready && (
          <div className="absolute bottom-8 right-8 z-30">
            <span className="font-mono-label text-[9px] uppercase text-foreground/60">
              Loading sequence
            </span>
          </div>
        )}

        {/*
          Mirrors the SQM clip's object-cover geometry: min-w/h fill the stage
          while aspect-ratio holds 16:9, so percentages inside land on the same
          point of the picture, at any viewport shape.
        */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-30 min-h-full min-w-full -translate-x-1/2 -translate-y-1/2"
          style={{ aspectRatio: VIDEO_ASPECT }}
        >
          <div
            ref={markerRef}
            className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 md:h-24 md:w-24"
            style={{ left: `${MARKER.x}%`, top: `${MARKER.y}%` }}
          >
            <div className="relative h-full w-full">
              <span className="absolute left-0 top-0 h-3 w-3 border-l border-t border-accent" />
              <span className="absolute right-0 top-0 h-3 w-3 border-r border-t border-accent" />
              <span className="absolute bottom-0 left-0 h-3 w-3 border-b border-l border-accent" />
              <span className="absolute bottom-0 right-0 h-3 w-3 border-b border-r border-accent" />
            </div>
            <span className="font-mono-label absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap text-[10px] uppercase text-accent">
              Leak located
            </span>
          </div>
        </div>

        {/* ACT I — hero */}
        <div
          ref={heroRef}
          className="absolute inset-0 z-30 flex flex-col items-start justify-end px-6 pb-24 md:px-10 lg:px-16 lg:pb-28"
        >
          <p className="font-mono-label mb-4 text-[10px] uppercase text-foreground/55">
            Physical AI &middot; Field Operations
          </p>
          {/*
            Deliberately restrained: the environment is the hero, so the headline
            is held to ~52px at the top end rather than filling the frame.
          */}
          <h1
            className="font-display text-balance font-bold uppercase leading-[1.08] tracking-tight text-foreground"
            style={{ fontSize: "clamp(1.6rem, 3.2vw, 3.25rem)", maxWidth: "22ch" }}
          >
            What happens when machines stop waiting for humans?
          </h1>
          <p
            className="mt-5 text-foreground/70"
            style={{ fontSize: "clamp(0.9rem, 1.05vw, 1.0625rem)", maxWidth: "44ch" }}
          >
            Physical AI is already moving from experiments to real-world operations.
          </p>
          {/*
            tabIndex={-1}: this control sits inside the aria-hidden cinematic
            stage (see the <section> below), so it's a mouse-only affordance —
            the sr-only summary above is the keyboard/AT path into the story.
          */}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => scrollToUnit(BEAT.kicker)}
            className="font-mono-label group mt-7 inline-flex items-center gap-2 rounded-full border border-foreground/25 px-5 py-2.5 text-[10px] uppercase text-foreground/90 transition-colors hover:border-accent hover:text-accent md:text-xs"
          >
            Explore what&apos;s possible
            <span
              aria-hidden="true"
              className="transition-transform group-hover:translate-y-0.5"
            >
              &darr;
            </span>
          </button>
        </div>

        <div ref={cueRef} className="absolute bottom-8 left-1/2 z-30 -translate-x-1/2">
          <div className="scroll-cue h-9 w-px bg-gradient-to-b from-foreground/60 to-transparent" />
        </div>

        <div
          ref={kickerRef}
          className="pointer-events-none absolute left-6 top-[26%] z-30 md:left-10 lg:left-16"
        >
          <span className="font-mono-label text-[10px] uppercase text-accent md:text-xs">
            SQM &middot; Mining Operations
          </span>
        </div>

        <div
          ref={problemRef}
          className="pointer-events-none absolute left-6 top-[32%] z-30 max-w-2xl md:left-10 lg:left-16"
        >
          <p className="font-display text-balance text-3xl font-semibold leading-[1.1] text-foreground md:text-5xl lg:text-6xl">
            Some problems take days to find.
          </p>
        </div>

        <div
          ref={searchRef}
          className="pointer-events-none absolute right-6 top-[34%] z-30 max-w-2xl text-right md:right-10 lg:right-16"
        >
          <p className="font-display text-balance text-3xl font-semibold leading-[1.1] text-foreground md:text-5xl lg:text-6xl">
            Physical AI changes the search.
          </p>
        </div>

        <div
          ref={droneMetaRef}
          className="pointer-events-none absolute bottom-16 left-6 z-30 md:left-10 lg:left-16"
        >
          <div className="border-l border-accent/60 pl-4">
            <p className="font-mono-label text-[10px] uppercase text-foreground/85 md:text-xs">
              Inspection unit
            </p>
            <p className="font-mono-label mt-1.5 text-[10px] uppercase text-accent md:text-xs">
              Autonomous
            </p>
          </div>
        </div>

        <div ref={outcomeRef} className="pointer-events-none absolute inset-0 z-30">
          <div
            ref={metricRef}
            className="absolute inset-x-0 top-[38%] flex flex-col items-center px-6 text-center"
          >
            <div className="font-display flex flex-wrap items-center justify-center gap-4 text-4xl font-black uppercase leading-none tracking-tight md:gap-7 md:text-7xl lg:text-8xl">
              <span className="text-foreground/45 line-through decoration-[3px]">Days</span>
              <span className="text-accent">&rarr;</span>
              <span className="text-accent">&lt;90 min</span>
            </div>
          </div>

          <div
            ref={impactRef}
            className="absolute inset-x-0 top-[56%] flex flex-col items-center px-6 text-center"
          >
            <p className="font-display text-xl font-semibold text-foreground md:text-3xl">
              Paid for itself in under a year.
            </p>
          </div>
        </div>

        <div
          ref={bridgeRef}
          className="pointer-events-none absolute inset-x-0 top-[40%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p className="font-display text-balance text-2xl font-semibold leading-[1.25] text-foreground md:text-4xl">
            This isn&apos;t a concept.
            <br />
            This is already being done.
          </p>
        </div>

        <div
          ref={hookRef}
          className="pointer-events-none absolute inset-x-0 top-[58%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p className="font-display text-balance text-2xl font-semibold leading-[1.2] text-accent md:text-4xl lg:text-5xl">
            But how did they make it work?
          </p>
        </div>

        {/* ACT II — locations annotated onto the terrain below */}
        {LOCATIONS.map((loc, i) => (
          <div
            key={loc.label}
            ref={(el) => {
              locRefs.current[i] = el;
            }}
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span className="relative flex h-2 w-2 items-center justify-center">
                {/*
                  The CSS keyframes drive opacity, which outranks GSAP's inline
                  style — so the pulse lives on an inner span and GSAP gates it
                  via this wrapper instead.
                */}
                {loc.destination && (
                  <span
                    ref={ringRef}
                    className="absolute inset-0 flex items-center justify-center opacity-0"
                  >
                    <span className="pulse-ring absolute h-4 w-4 rounded-full border border-accent-blue" />
                  </span>
                )}
                <span
                  className={
                    loc.origin
                      ? "h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_rgba(232,85,31,0.9)]"
                      : "h-1.5 w-1.5 rounded-full bg-foreground/60"
                  }
                />
              </span>
              <span
                ref={loc.destination ? destLabelRef : undefined}
                className={`font-mono-label whitespace-nowrap text-[9px] uppercase md:text-[10px] ${
                  loc.origin ? "text-accent" : "text-foreground/70"
                }`}
              >
                {loc.label}
              </span>
              {loc.sub ? (
                <span className="font-mono-label whitespace-nowrap text-[8px] uppercase text-foreground/60 md:text-[9px]">
                  {loc.sub}
                </span>
              ) : null}
            </div>
          </div>
        ))}

        <div
          ref={headlineRef}
          className="pointer-events-none absolute inset-x-0 top-[20%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p className="font-display text-balance text-2xl font-bold uppercase leading-[1.1] tracking-tight text-foreground md:text-5xl lg:text-6xl">
            This isn&apos;t one industry.
          </p>
        </div>

        <div
          ref={sublineRef}
          className="pointer-events-none absolute inset-x-0 top-[31%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p className="text-balance max-w-lg text-sm text-foreground/75 md:text-base">
            Physical AI is already changing how the world operates.
          </p>
        </div>

        {/* ACT III — public safety */}
        <div
          ref={psKickerRef}
          className="pointer-events-none absolute left-6 top-[26%] z-30 md:left-10 lg:left-16"
        >
          <span className="font-mono-label text-[10px] uppercase text-accent-blue md:text-xs">
            Public Safety &middot; Drone as First Responder
          </span>
        </div>

        <div
          ref={emergencyRef}
          className="pointer-events-none absolute left-6 top-[33%] z-30 max-w-2xl md:left-10 lg:left-16"
        >
          <p className="font-display text-balance text-3xl font-semibold leading-[1.1] text-foreground md:text-5xl lg:text-6xl">
            An emergency.
          </p>
        </div>

        <div
          ref={dispatchRef}
          className="pointer-events-none absolute right-6 top-[35%] z-30 max-w-2xl text-right md:right-10 lg:right-16"
        >
          <p className="font-display text-balance text-3xl font-semibold leading-[1.1] text-foreground md:text-5xl lg:text-6xl">
            A drone is dispatched.
          </p>
        </div>

        <div
          ref={arrivesRef}
          className="pointer-events-none absolute inset-x-0 top-[42%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p className="font-display max-w-4xl text-4xl font-black uppercase leading-[1.05] tracking-tight text-accent-blue md:text-6xl lg:text-7xl">
            It arrives before
            <br />
            the patrol car.
          </p>
        </div>

        {/* ACT IV — the realization */}
        <div
          ref={realizationRef}
          className="pointer-events-none absolute inset-x-0 top-[17%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p
            className="font-display font-bold uppercase leading-[1.1] tracking-tight text-foreground"
            style={{ fontSize: "clamp(1.5rem, 3.4vw, 3.25rem)" }}
          >
            Different industries.
            <br />
            Same shift.
          </p>
        </div>

        <div
          ref={realizationSubRef}
          className="pointer-events-none absolute inset-x-0 top-[31%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p
            className="text-foreground/70"
            style={{ fontSize: "clamp(0.85rem, 1vw, 1rem)", maxWidth: "46ch" }}
          >
            Physical AI is already changing how the world operates.
          </p>
        </div>

        {/* ACT V — the practical question */}
        <div
          ref={questionRef}
          className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p
            className="font-display font-bold uppercase leading-[1.1] tracking-tight text-foreground"
            style={{ fontSize: "clamp(1.4rem, 3vw, 2.85rem)", maxWidth: "24ch" }}
          >
            But how are they actually making this work?
          </p>
        </div>

        <div
          ref={challengesRef}
          className="pointer-events-none absolute inset-x-0 top-[52%] z-30 flex flex-wrap items-start justify-center gap-x-8 gap-y-5 px-6 md:gap-x-14"
        >
          {CHALLENGES.map((c, i) => (
            <span
              key={c}
              ref={(el) => {
                challengeItemRefs.current[i] = el;
              }}
              className="flex flex-col items-center gap-2"
            >
              <span className="h-px w-8 bg-accent/50" />
              <span className="font-mono-label text-[10px] uppercase text-foreground/75 md:text-[11px]">
                {c}
              </span>
            </span>
          ))}
        </div>

        {/* ACT VI — NestGen is the answer */}
        {/* the mark is the focal point of the reveal */}
        <div
          ref={logoRef}
          className="pointer-events-none absolute inset-x-0 top-[24%] z-30 flex flex-col items-center px-6"
        >
          <NestGenLogo height="clamp(112px, 15vw, 208px)" maxRenderedWidth={240} />
        </div>

        <div
          ref={seeHowRef}
          className="pointer-events-none absolute inset-x-0 top-[57%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p className="font-mono-label text-[10px] uppercase text-accent-purple md:text-xs">
            See how they made it work.
          </p>
        </div>

        <div
          ref={nestgenNameRef}
          className="pointer-events-none absolute inset-x-0 top-[64%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p
            className="font-display font-bold uppercase leading-none tracking-tight text-foreground"
            style={{ fontSize: "clamp(1.5rem, 3.6vw, 3rem)" }}
          >
            NestGen &rsquo;26
          </p>
        </div>

        <div
          ref={eventMetaRef}
          className="pointer-events-none absolute inset-x-0 top-[73%] z-30 flex flex-col items-center gap-2 px-6 text-center"
        >
          <span className="font-mono-label text-[10px] uppercase text-accent-purple md:text-xs">
            29 September 2026
          </span>
          {/* No official venue was supplied, so this stays a placeholder rather than an invented location. */}
          <span className="font-mono-label text-[9px] uppercase text-foreground/60 md:text-[10px]">
            Venue to be confirmed
          </span>
        </div>

        {/* ACT VII — registration */}
        <div
          ref={ctaHeadRef}
          className="pointer-events-none absolute inset-x-0 top-[26%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p
            className="font-display font-bold uppercase leading-[1.12] tracking-tight text-foreground"
            style={{ fontSize: "clamp(1.4rem, 3vw, 2.85rem)", maxWidth: "26ch" }}
          >
            The future isn&apos;t something to watch.
            <br />
            It&apos;s something to build.
          </p>
        </div>

        <div
          ref={ctaSubRef}
          className="pointer-events-none absolute inset-x-0 top-[47%] z-30 flex flex-col items-center px-6 text-center"
        >
          <p
            className="text-foreground/70"
            style={{ fontSize: "clamp(0.85rem, 1vw, 1rem)", maxWidth: "44ch" }}
          >
            See how the people already doing it made it work.
          </p>
        </div>

        <div
          ref={ctaButtonRef}
          id="register"
          className="pointer-events-none absolute inset-x-0 top-[58%] z-40 flex flex-col items-center px-6 text-center"
        >
          {/*
            No official registration URL exists in the project, so this is left
            un-pointed rather than invented.
            TODO: set href to the real registration URL.
          */}
          <a
            href="#register"
            tabIndex={-1}
            className="font-mono-label inline-flex items-center gap-3 rounded-full bg-accent-purple-deep px-8 py-4 text-[11px] uppercase text-[#f5f2ee] transition-transform hover:scale-[1.02] md:text-xs"
          >
            Register for NestGen &rsquo;26 <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </section>
    </div>
  );
}
