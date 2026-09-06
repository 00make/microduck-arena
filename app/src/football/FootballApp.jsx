// Football-mode app shell (?mode=football). A sibling of App.jsx with the
// match's own title flow: FootballTitle holds a boot gate ("Loading
// teams...") over the live pitch, then the "Kick Off" CTA drops it. The
// game core boots eagerly behind the overlay and the AI plays on from the
// first control step, so kickoff is a UI gate - the overlay closes and the
// broadcast framing takes over.
// Layers in z order: scene canvas (1), halftone (2), CRT treatment (5),
// match HUD (10), title overlay (30).
import { useEffect, useRef } from "react";
import FootballCanvas from "./FootballCanvas.jsx";
import FootballHud from "./FootballHud.jsx";
import FootballTitle from "./FootballTitle.jsx";
import { Halftone, CrtOverlay } from "../ui/Overlays.jsx";
import { useGame } from "../store.js";

export default function FootballApp() {
  // prebootDone marks the shell ready; menuOpen raises the title/boot gate
  // (same store flags the sandbox flow uses, so FootballHud's Back button
  // reopens the overlay as pause and the game core's menuOpen subscription
  // ducks the ambient bed). `entered` latches on the first Kick Off -
  // FootballTitle sets it alongside menuOpen:false.
  useEffect(() => {
    useGame.setState({ prebootDone: true, menuOpen: true });
  }, []);

  // The match itself already runs from boot (game.js kicks off during
  // bootGame), so kickoff only needs a forward-compat poke at the debug
  // surface: today window.football exposes ducks/ball/model/step/bench/
  // config but no startMatch - when the referee integration lands one,
  // this starts calling it. Guarded so React StrictMode's double effect
  // (and pause-menu Resumes) never fire it twice.
  const kickoffFired = useRef(false);
  const handleKickoff = () => {
    if (kickoffFired.current) return;
    kickoffFired.current = true;
    window.football?.startMatch?.();
  };

  return (
    <>
      <FootballCanvas />
      <Halftone />
      <CrtOverlay />
      <FootballHud />
      <FootballTitle onKickOff={handleKickoff} />
    </>
  );
}
