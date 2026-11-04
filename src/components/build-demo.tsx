"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { ForgeMark } from "./forge-mark";
import styles from "./build-demo.module.css";

const brief =
  "Build a responsive coffee catalog for a fictional roaster called Index Coffee. " +
  "Store two roasts, House (fig and cacao) and Light (apricot and tea), with their tasting notes in the database. " +
  "Show an oversized Ground study. headline, original monochrome contour artwork, and a keyboard-accessible roast selector. " +
  "Selecting a roast should update the label, tasting notes, and artwork on the page.";

const steps = [
  { at: 0, phase: "brief", action: "Read the brief" },
  { at: 650, phase: "grid", action: "Write forge.schema.json" },
  { at: 1450, phase: "wire", action: "Create src/App.tsx" },
  { at: 2350, phase: "type", action: "Set the headline" },
  { at: 3650, phase: "style", action: "Apply src/styles.css" },
  { at: 4650, phase: "done", action: "Open the preview" },
] as const;
const title = "Ground study.";
const finished = steps[steps.length - 1].at;
const loopEnd = finished + 5500;

function DraftingBird() {
  return <svg viewBox="0 0 22 18" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <path fillRule="evenodd" d="M13 1h2v1h2v2h5v1h-4v2h-3v3h-2v2h-2v2H9v2h3v1H8v-4H6v2H4v-1h1v-2H3v-2H2V8H1V6H0V4h2v1h3v2h4V6h2V4h2zm1 3v1h1V4zm-9 5v1h3V9z" />
  </svg>;
}

// A new, approved source for either appearance needs only this mapping.
const presence = {
  mark: (thinking: boolean) => <ForgeMark thinking={thinking} />,
  pet: () => <DraftingBird />,
};
type Appearance = keyof typeof presence;

// useDemoClock is the local timeline. A future live demo can supply the same
// phase and headline events from a server stream. Keep its credentials on the
// server, close the stream on unmount and label the source in the demo footer.
function useDemoClock() {
  const root = useRef<HTMLElement>(null);
  const controls = useRef<{ toggle(): void; replay(): void; pause(): void } | null>(null);
  const [frame, setFrame] = useState({ index: steps.length - 1, letters: title.length, paused: true, running: false });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paused = motion.matches;
    let elapsed: number = paused ? finished : 0;
    let started: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let active = true;

    function stop() {
      clearTimeout(timeout);
      if (started !== null) elapsed += performance.now() - started;
      started = null;
    }
    function sync() {
      stop();
      if (elapsed >= finished && motion.matches) {
        elapsed = finished;
        paused = true;
      } else if (elapsed >= loopEnd) elapsed %= loopEnd;
      const next = steps.findIndex(step => step.at > elapsed);
      const index = (next < 0 ? steps.length : next) - 1;
      const step = steps[index];
      const typing = step.phase === "type" && !motion.matches;
      const letters = typing ? Math.min(title.length, 1 + Math.floor((elapsed - step.at) / 75)) : title.length;
      const running = visible && active && !document.hidden && !paused;
      setFrame({ index, letters, paused, running });
      if (!running) return;
      started = performance.now();
      const nextStep = next < 0 ? loopEnd : steps[next].at;
      const deadline = typing && letters < title.length ? Math.min(nextStep, step.at + letters * 75) : nextStep;
      timeout = setTimeout(sync, Math.max(1, deadline - elapsed));
    }
    function replay() {
      stop();
      elapsed = 0;
      paused = false;
      sync();
    }
    controls.current = {
      replay,
      toggle() {
        if (paused && elapsed >= finished) return replay();
        paused = !paused;
        sync();
      },
      pause() { paused = true; sync(); },
    };
    function measureVisibility() {
      const rect = root.current?.getBoundingClientRect();
      const next = !!rect && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      if (visible !== next) { visible = next; sync(); }
    }
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      visible = entries[entries.length - 1].isIntersecting;
      sync();
    });
    if (observer) observer.observe(element);
    else {
      measureVisibility();
      window.addEventListener("scroll", measureVisibility, { capture: true, passive: true });
      window.addEventListener("resize", measureVisibility);
    }
    function preferenceChanged() {
      if (motion.matches) { stop(); elapsed = finished; paused = true; }
      sync();
    }
    function hide() { active = false; sync(); }
    function show() { active = true; sync(); }
    sync();
    motion.addEventListener("change", preferenceChanged);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      active = false;
      stop();
      controls.current = null;
      observer?.disconnect();
      window.removeEventListener("scroll", measureVisibility, true);
      window.removeEventListener("resize", measureVisibility);
      motion.removeEventListener("change", preferenceChanged);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, []);
  return { root, controls, frame };
}

const contour = "M-104 0C-102-40-57-51-27-61C7-75 6-92 47-78C82-68 115-31 105 9C97 37 64 42 39 60C13 82-15 82-54 64C-91 49-110 32-104 0Z";
const contours = Array.from({length: 12}, (_, i) => (
  <path key={i} transform={`translate(120 88) scale(${(i + 2) / 13})`} d={contour} />
));

export function BuildDemo({ onUseBrief, onClose }: { onUseBrief(prompt: string): void; onClose(): void }) {
  const { root, controls, frame } = useDemoClock();
  const id = useId();
  const [appearance, setAppearance] = useState<Appearance>("mark");
  const [lightRoast, setLightRoast] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const phase = steps[frame.index].phase;
  const done = phase === "done";
  const appearances = ["mark", "pet"] as const;
  return (
    <section className={styles.demo} ref={root} data-demo-phase={phase} data-playing={frame.running} aria-labelledby={id + "title"}>
      <header className={styles.bar}>
        <div><span className={styles.label}>Guided example</span><h2 id={id + "title"}>Watch a build</h2></div>
        <button type="button" className={styles.icon} onClick={onClose} aria-label="Close build demo"><X size={17} /></button>
      </header>
      <div className={styles.workbench}>
        <div className={styles.browser}>
          <div className={styles.chrome}><span className={styles.dots} aria-hidden="true">● ● ●</span><span>Preview / Index Coffee</span></div>
          <div className={styles.canvas}>
            <div className={styles.grid} aria-hidden="true" />
            <div className={styles.wire} aria-hidden="true"><i/><i/><i/><i/></div>
            <article className={styles.coffee} aria-label="Example coffee catalog" aria-hidden={frame.index < 3 || undefined} data-roast={lightRoast ? "light" : "house"}>
              <div className={styles.mast}><span>Index Coffee</span><small>Roast index</small></div>
              <div className={styles.spread}>
                <div><small>Morning edition</small><h3 aria-label={title}><span aria-hidden="true">{title.slice(0, frame.letters)}</span></h3></div>
                <svg viewBox="0 0 240 176" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{contours}</svg>
              </div>
              <div className={styles.catalog}>
                <span>{lightRoast ? "Apricot & tea" : "Fig & cacao"}</span>
                <div role="group" aria-label="Sample roast" onFocus={() => controls.current?.pause()}>
                  {["House", "Light"].map((name, i) => <button type="button" key={name} disabled={!done} aria-pressed={lightRoast === (i === 1)} onClick={() => setLightRoast(i === 1)}>{name}</button>)}
                </div>
              </div>
            </article>
          </div>
        </div>
        <div className={styles.console}>
          <div className={styles.consoleHeader}><span className={styles.label}>Build trace</span>
            <div role="tablist" aria-label="Agent appearance" className={styles.tabs}>
              {appearances.map((name, i) => (
                <button key={name} ref={el => { tabs.current[i] = el; }} id={id + name} type="button" role="tab"
                  aria-controls={id + name + "panel"} aria-selected={name === appearance} tabIndex={name === appearance ? 0 : -1}
                  onClick={() => setAppearance(name)} onKeyDown={e => {
                    let next: number;
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") next = 1 - i;
                    else if (e.key === "Home") next = 0;
                    else if (e.key === "End") next = 1;
                    else return;
                    e.preventDefault(); setAppearance(appearances[next]); tabs.current[next]?.focus();
                  }}>{name === "mark" ? "Mark" : "Pixel pet"}</button>
              ))}
            </div>
          </div>
          {appearances.map(name => {
            return <div key={name} role="tabpanel" id={id + name + "panel"} aria-labelledby={id + name} tabIndex={0} hidden={name !== appearance} className={styles.track}>
              <span className={name === "mark" ? styles.mark : styles.runner}><span className={styles.sprite}>{presence[name](frame.running && !done && name === appearance)}</span></span>
            </div>;
          })}
          <ol className={styles.log} aria-label="Example build steps">
            {steps.map((step, i) => <li key={step.phase} data-future={i > frame.index} aria-current={i === frame.index ? "step" : undefined}>
              <time dateTime={`PT${step.at / 1000}S`}>{(step.at / 1000).toFixed(1)}s</time>{step.action}
            </li>)}
          </ol>
          <div className={styles.transport}>
            <button type="button" onClick={() => controls.current?.toggle()}>{frame.paused ? <Play size={13}/> : <Pause size={13}/>}{frame.paused ? "Play" : "Pause"}</button>
            <button type="button" onClick={() => controls.current?.replay()}><RotateCcw size={13}/>Replay</button>
          </div>
        </div>
      </div>
      <footer className={styles.foot}><p>Scripted walkthrough. Pick a roast in the finished preview.</p>
        <button type="button" onClick={() => onUseBrief(brief)}>Use this brief <ArrowUpRight size={14}/></button>
      </footer>
    </section>
  );
}
