// Soundboard experiment page (?soundboard=1): trigger and A/B-compare every
// game sound - the CURRENT runtime implementation (straight from audio.js,
// exact same code paths, non-spatial) against a ZzFX-synthesized candidate.
// Throwaway experiment: plain CSS, no game boot, additive only.
import { useEffect, useRef, useState } from "react";
import {
  audioCtx, busNode, preloadSfx, playSfx, playUrl, uiClick,
  startAmbient, setRumble, playEntranceSweep, playPropSweep, playLineBlip,
  playBiosBeep, playBiosTick, playConfirmBloop,
} from "../game/audio.js";
import { signed } from "../game/signed.js";
import { zzfx } from "../game/vendor/zzfx.js";

// Bus levels mirrored from audio.js BUS_LEVELS; the master volume slider
// rescales the (module-private) bus gains through busNode(), which is safe
// here because the game never mounts on this page.
const BUS_DEFAULTS = { ambient: 1, sfx: 0.9, voice: 1 };

// ZzFX candidate presets. Parameter order:
// [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
//  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation,
//  bitCrush, delay, sustainVolume, decay, tremolo, filter]
// Shapes: 0 sin, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square (duty=shapeCurve/2).
export const ZZFX_PRESETS = {
  // Soft noise-burst tap, quick pitch drop, mirrors the Kenney step takes.
  footstepTap: [1.4, .3, 120, .001, .01, .05, 4, 1.9, -12, , , , , 1.3, , .1, , .5, .02],
  // Duller, breathier alternative take (more noise, lower).
  footstepSoft: [1.1, .4, 85, .001, .008, .04, 4, 2.2, -8, , , , , 2, , .2, , .45, .015],
  // Round sine drop with a fast slide: hollow bouncing-ball body.
  ballThump: [2, .15, 210, .002, .02, .16, 0, 2.4, -30, , , , , .3, , , , .8, .08],
  // Same family an octave-ish down, more noise: duller body bump.
  bodyBump: [1.7, .2, 90, .002, .03, .19, 0, 2.9, -15, , , , , 1, , .3, , .7, .11],
  // Tiny triangle tick around 1.1 kHz.
  uiClick: [.5, .2, 1100, .001, .005, .02, 1, 1.4, , , , , , , , , , .6, .01],
  // Two rising square notes C5 -> G5 (pitchJump +261 Hz at 70 ms).
  confirmBloop: [.7, 0, 523, .005, .12, .08, 5, 1, , , 261, .07, , , , , , .8, .02],
  // Classic single POST beep, steady 940 Hz square.
  biosBeep: [.4, 0, 940, .004, .1, .05, 5, 1, , , , , , , , , , .9, .01],
  // Whisper teletype tick, high square with slight randomness.
  biosTick: [.25, .2, 1850, .001, .004, .014, 5, 1, , , , , , , , , , .5, .005],
  // Per-line scan chirp ~1.9 kHz triangle; randomness spreads the flurry.
  scanBlip: [.35, .25, 1900, .001, .01, .04, 1, 1, , , , , , , , , , .6, .01],
  // Rising saw sweep + noise shimmer + long release: sweep approximation.
  entranceSweep: [1, 0, 150, .05, .5, .3, 2, 1, 11, .4, , , , .35, , .15, , .8, .2],
};

// Resume-then-run wrapper: every trigger lands in a user gesture, so a
// suspended context gets one resume attempt before the sound fires (the
// runtime helpers silently no-op on a suspended context).
async function armed(fn) {
  const c = audioCtx();
  if (c.state === "suspended") {
    try { await c.resume(); } catch { return; }
  }
  fn();
}

// ZzFX candidates land on the sfx bus: same master gain as the runtime.
const playZ = (params) => zzfx(audioCtx(), busNode("sfx"), ...params);

const CHIRP_TAKES = "abcdefghijkl";

export default function Soundboard() {
  const [vol, setVol] = useState(1);
  const [ambientOn, setAmbientOn] = useState(false);
  const [rumbleOn, setRumbleOn] = useState(false);
  const [wheeeOn, setWheeeOn] = useState(false);
  const wheeeRide = useRef(null);
  const chirpIdx = useRef(0);

  useEffect(() => {
    audioCtx();
    preloadSfx();
  }, []);

  // Master volume: rescale all three bus gains (ambient stays at 0 while
  // its loop toggle is off - startAmbient() has no runtime stop hook, so
  // the toggle gates the whole ambient bus instead).
  useEffect(() => {
    audioCtx();
    for (const [name, base] of Object.entries(BUS_DEFAULTS)) {
      const scale = name === "ambient" && !ambientOn ? 0 : vol;
      busNode(name).gain.value = base * scale;
    }
  }, [vol, ambientOn]);

  const toggleAmbient = () => armed(() => {
    if (!ambientOn) startAmbient();
    setAmbientOn((v) => !v);
  });

  const toggleRumble = () => armed(() => {
    setRumble(rumbleOn ? 0 : 0.7);
    setRumbleOn((v) => !v);
  });

  // Wheee reference loop: minimal version of the game's ride (loop take a,
  // voice bus, short fades). Token in the ref guards the decode race.
  const toggleWheee = () => armed(async () => {
    const c = audioCtx();
    const ride = wheeeRide.current;
    if (ride) {
      wheeeRide.current = null;
      setWheeeOn(false);
      if (ride.src) {
        ride.gain.gain.setTargetAtTime(0, c.currentTime, 0.05);
        try { ride.src.stop(c.currentTime + 0.3); } catch { /* ended */ }
      }
      return;
    }
    const next = {};
    wheeeRide.current = next;
    setWheeeOn(true);
    let buf;
    try {
      const res = await fetch(signed("./assets/voices/duck1/wheee_loop_a.wav"));
      buf = await c.decodeAudioData(await res.arrayBuffer());
    } catch {
      if (wheeeRide.current === next) { wheeeRide.current = null; setWheeeOn(false); }
      return;
    }
    if (wheeeRide.current !== next) return; // toggled off during decode
    const gain = c.createGain();
    gain.connect(busNode("voice"));
    const t0 = c.currentTime + 0.02;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.7, t0 + 0.02);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start(t0);
    Object.assign(next, { src, gain });
  });

  const playQuack = () => {
    const take = CHIRP_TAKES[chirpIdx.current++ % CHIRP_TAKES.length];
    playUrl(signed(`./assets/voices/duck1/chirp_${take}.wav`), { gain: 0.7 });
  };

  // One-shot rows: name, category, note, current trigger, zzfx candidates.
  const rows = [
    {
      name: "Footstep", cat: "sampled", note: "step_a-e, random take, in-game gain/rate spread",
      current: () => playSfx("step", { gain: 0.2, rate: 0.9 + Math.random() * 0.25 }),
      zz: [["tap", ZZFX_PRESETS.footstepTap], ["soft", ZZFX_PRESETS.footstepSoft]],
    },
    {
      name: "Ball thump", cat: "sampled", note: "thump_a-c, mid-strength kick",
      current: () => playSfx("thump", { gain: 0.34, rate: 1.05 + Math.random() * 0.08 }),
      zz: [["thump", ZZFX_PRESETS.ballThump]],
    },
    {
      name: "Body bump", cat: "sampled", note: "thump takes pitched down to ~0.57",
      current: () => playSfx("thump", { gain: 0.27, rate: 0.57 + Math.random() * 0.06 }),
      zz: [["bump", ZZFX_PRESETS.bodyBump]],
    },
    {
      name: "UI click", cat: "sampled", note: "click_a/b via uiClick()",
      current: () => uiClick(),
      zz: [["click", ZZFX_PRESETS.uiClick]],
    },
    {
      name: "Confirm bloop", cat: "synth", note: "menu confirm, C5 -> G5 squares",
      current: () => playConfirmBloop(),
      zz: [["bloop", ZZFX_PRESETS.confirmBloop]],
    },
    {
      name: "BIOS beep", cat: "synth", note: "POST beep, 940 Hz square",
      current: () => playBiosBeep(),
      zz: [["beep", ZZFX_PRESETS.biosBeep]],
    },
    {
      name: "BIOS tick", cat: "synth", note: "teletype tick per POST line",
      current: () => playBiosTick(),
      zz: [["tick", ZZFX_PRESETS.biosTick]],
    },
    {
      name: "Scan blip", cat: "synth", note: "per-line entrance blip, random pitch",
      current: () => playLineBlip(Math.random()),
      zz: [["blip", ZZFX_PRESETS.scanBlip]],
    },
    {
      name: "Entrance sweep", cat: "synth", note: "3-layer materialize sweep + thunk + ping (0.9 s)",
      current: () => playEntranceSweep(0.9),
      zz: [["sweep", ZZFX_PRESETS.entranceSweep]],
    },
    {
      name: "Prop sweep (small)", cat: "synth", note: "duck-sized prop materialize (0.9 s, quieter, no garnish)",
      current: () => playPropSweep(0.9),
      zz: null,
    },
    {
      name: "Prop sweep (cabinet)", cat: "synth", note: "big prop: size-stretched 2.2 s, register dropped by the stretch",
      current: () => playPropSweep(2.2),
      zz: null,
    },
    {
      name: "Quack", cat: "voice", note: "reference only, chirp takes a-l round-robin",
      current: playQuack,
      zz: null,
    },
  ];

  const loops = [
    {
      name: "Ambient bed", cat: "synth", note: "arcade-room hum loop; ZzFX n/a (already synth)",
      on: ambientOn, toggle: toggleAmbient,
    },
    {
      name: "Roller rumble", cat: "synth", note: "rolling-noise loop at 0.7 speed; ZzFX n/a (already synth)",
      on: rumbleOn, toggle: toggleRumble,
    },
    {
      name: "Wheee", cat: "voice", note: "reference only, loop take a on the voice bus",
      on: wheeeOn, toggle: toggleWheee,
    },
  ];

  return (
    <div className="sb-root">
      <style>{CSS}</style>
      <header className="sb-head">
        <h1>Microduck Soundboard</h1>
        <p className="sb-sub">
          A/B: current runtime implementation vs ZzFX candidate. First click unlocks audio.
        </p>
        <label className="sb-vol">
          Master volume
          <input
            type="range" min="0" max="1" step="0.01" value={vol}
            aria-label="Master volume"
            onChange={(e) => setVol(Number(e.target.value))}
          />
          <span>{Math.round(vol * 100)}%</span>
        </label>
      </header>

      <div className="sb-grid" role="table" aria-label="One-shot sounds">
        <div className="sb-row sb-row-head" role="row">
          <span>Sound</span><span>Category</span><span>Current</span><span>ZzFX candidate</span>
        </div>
        {rows.map((r) => (
          <div className="sb-row" role="row" key={r.name}>
            <span className="sb-name">
              {r.name}
              <small>{r.note}</small>
            </span>
            <span><em className={`sb-cat sb-cat-${r.cat}`}>{r.cat}</em></span>
            <span>
              <button type="button" className="sb-btn sb-btn-cur" onClick={() => armed(r.current)}>
                Play
              </button>
            </span>
            <span className="sb-zz">
              {r.zz
                ? r.zz.map(([label, params]) => (
                  <button
                    type="button" key={label} className="sb-btn sb-btn-zz"
                    onClick={() => armed(() => playZ(params))}
                  >
                    {label}
                  </button>
                ))
                : <em className="sb-na">n/a (voice reference)</em>}
            </span>
          </div>
        ))}
      </div>

      <h2 className="sb-h2">Loops</h2>
      <div className="sb-grid" role="table" aria-label="Looping sounds">
        {loops.map((l) => (
          <div className="sb-row" role="row" key={l.name}>
            <span className="sb-name">
              {l.name}
              <small>{l.note}</small>
            </span>
            <span><em className={`sb-cat sb-cat-${l.cat}`}>{l.cat}</em></span>
            <span>
              <button
                type="button"
                className={`sb-btn sb-btn-cur ${l.on ? "sb-on" : ""}`}
                aria-pressed={l.on}
                onClick={l.toggle}
              >
                {l.on ? "Stop" : "Start"}
              </button>
            </span>
            <span className="sb-zz"><em className="sb-na">n/a</em></span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CSS = `
/* The game's index.html pins body { overflow: hidden } for the canvas;
   this page is a document, so re-enable normal scrolling. */
html, body { height: auto; overflow: auto; }
#root { height: auto; }
.sb-root {
  min-height: 100vh;
  background: #faf8f2;
  color: #101018;
  font: 15px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 2.2rem clamp(1rem, 5vw, 4rem) 4rem;
}
.sb-head h1 {
  font-family: 'Anton', 'Arial Narrow', Impact, sans-serif;
  font-size: clamp(2rem, 5vw, 3.2rem);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 0;
  color: #101018;
  -webkit-text-stroke: 1px #101018;
}
.sb-sub { margin: 0.3rem 0 1.2rem; opacity: 0.75; }
.sb-vol {
  display: inline-flex; align-items: center; gap: 0.7rem;
  border: 2px solid #101018; background: #fff;
  padding: 0.5rem 0.9rem; box-shadow: 4px 4px 0 #101018;
  margin-bottom: 1.6rem; font-weight: 700;
}
.sb-vol input { accent-color: #ff7a2f; width: 200px; }
.sb-h2 {
  font-family: 'Anton', 'Arial Narrow', Impact, sans-serif;
  text-transform: uppercase; margin: 2rem 0 0.6rem;
}
.sb-grid { border: 2px solid #101018; background: #fff; box-shadow: 6px 6px 0 #101018; }
.sb-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.6fr) 110px 130px minmax(160px, 1fr);
  align-items: center; gap: 0.8rem;
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid rgba(16, 16, 24, 0.18);
}
.sb-row:last-child { border-bottom: none; }
.sb-row-head {
  font-weight: 700; text-transform: uppercase; font-size: 12px;
  background: #101018; color: #faf8f2;
}
.sb-name { display: flex; flex-direction: column; font-weight: 700; }
.sb-name small { font-weight: 400; opacity: 0.6; font-size: 11px; }
.sb-cat {
  font-style: normal; font-size: 11px; font-weight: 700;
  text-transform: uppercase; padding: 2px 7px; border: 1.5px solid #101018;
}
.sb-cat-sampled { background: #ffe9db; }
.sb-cat-synth { background: #e5eeff; }
.sb-cat-voice { background: #fff3b0; }
.sb-btn {
  font: inherit; font-weight: 700; text-transform: uppercase; font-size: 12px;
  border: 2px solid #101018; padding: 0.35rem 0.9rem; cursor: pointer;
  box-shadow: 3px 3px 0 #101018; background: #faf8f2; color: #101018;
  margin: 2px 6px 2px 0;
}
.sb-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #101018; }
.sb-btn:focus-visible { outline: 3px solid #ff7a2f; outline-offset: 2px; }
.sb-btn-zz { background: #ff7a2f; color: #101018; }
.sb-btn-cur.sb-on { background: #101018; color: #faf8f2; }
.sb-na { opacity: 0.5; font-size: 12px; }
@media (max-width: 700px) {
  .sb-row { grid-template-columns: 1fr; gap: 0.3rem; }
  .sb-row-head { display: none; }
}
`;
