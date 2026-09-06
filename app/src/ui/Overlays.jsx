// Full-viewport decorative layers over the 3D scene: halftone dots and the
// CRT/old-TV treatment (scanlines + boiling static + vignette). Stacked at
// z 2-5: above the canvas, below the HUD (z 10), the BIOS screen (z 20)
// and the title overlay (z 30) - the interface stays crisp and only the
// scene gets the old-TV treatment.
//
// Performance: the only animation is a transform-only jitter on the noise
// layer, so everything stays on the compositor and never repaints the
// WebGL canvas underneath.
import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";

const crtNoise = keyframes`
  0% { transform: translate(0, 0); }
  25% { transform: translate(-45px, 30px); }
  50% { transform: translate(25px, -55px); }
  75% { transform: translate(-30px, -15px); }
  100% { transform: translate(0, 0); }
`;

const NOISE_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.7 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function Halftone() {
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2,
        pointerEvents: "none",
        backgroundImage:
          "radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1.5px)",
        backgroundSize: "21px 21px",
        maskImage: "linear-gradient(to bottom, transparent 30%, black 100%)",
      }}
    />
  );
}

export function CrtOverlay() {
  const scanlineOpacity = 0.13;
  const scanlinePitch = "3px";
  const noiseOpacity = 0.045;
  const vignetteOpacity = 0.42;
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 5,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* SCANLINES: one thin dark line every pitch, plus a very faint
          vertical RGB fringe (aperture-grille tint). Static. */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          opacity: scanlineOpacity,
          background: `repeating-linear-gradient(
              to bottom,
              rgba(0, 0, 0, 0.55) 0,
              rgba(0, 0, 0, 0.55) 1px,
              transparent 1px,
              transparent ${scanlinePitch}
            ),
            repeating-linear-gradient(
              to right,
              rgba(255, 70, 60, 0.05) 0,
              rgba(255, 70, 60, 0.05) 1px,
              rgba(70, 255, 90, 0.035) 1px,
              rgba(70, 255, 90, 0.035) 2px,
              rgba(70, 110, 255, 0.05) 2px,
              rgba(70, 110, 255, 0.05) 3px
            )`,
        }}
      />
      {/* NOISE: tiled SVG turbulence, jittered between four offsets with
          steps() so the grain "boils" like broadcast static. */}
      <Box
        sx={{
          position: "absolute",
          inset: "-80px",
          backgroundImage: NOISE_SVG,
          backgroundSize: "160px 160px",
          opacity: noiseOpacity,
          animation: `${crtNoise} 0.5s steps(1) infinite`,
          willChange: "transform",
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
      {/* VIGNETTE: gently darkened corners, like curved CRT glass. */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(
            115% 90% at 50% 50%,
            transparent 62%,
            rgba(0, 0, 0, ${vignetteOpacity}) 100%
          )`,
        }}
      />
    </Box>
  );
}
