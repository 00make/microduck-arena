// Comic-DA primitives, ported from the pollen-website Microduck landing
// (ComicButton.tsx / FancyTitle.tsx): brutal print blocks - a flat face,
// a thick ink keyline and a hard offset plate - plus the Anton display
// voice with the mistracked-VHS title treatment. Lightweight JSX
// reimplementation for the sim; no code is shared across repos on purpose.
import Box from "@mui/material/Box";

export const COMIC_INK = "#101018";
export const CREAM = "#faf8f2";
export const COMIC_ORANGE = "#FF7A2F";
export const COMIC_YELLOW = "#FFD23F";
// The MTV experiment's acid plate colours: on ink grounds the offset plate
// swaps to these so it still reads (ink on ink would vanish).
export const ACID_MAGENTA = "#FF2FA8";
export const ACID_CYAN = "#2FF0E6";
export const ANTON = "'Anton', 'Arial Narrow', Impact, sans-serif";

// Colour presets, same tuning as the landing: `bg` face, `text` label,
// `edge` keyline, `shadow` plate on paper grounds, `shadowOnDark` the acid
// swap for ink grounds.
const SCHEMES = {
  orange: { bg: COMIC_ORANGE, text: COMIC_INK, edge: COMIC_INK, shadow: COMIC_INK, shadowOnDark: ACID_MAGENTA },
  yellow: { bg: COMIC_YELLOW, text: COMIC_INK, edge: COMIC_INK, shadow: COMIC_INK, shadowOnDark: ACID_CYAN },
  ink: { bg: COMIC_INK, text: CREAM, edge: COMIC_INK, shadow: COMIC_ORANGE, shadowOnDark: COMIC_ORANGE },
  paper: { bg: CREAM, text: COMIC_INK, edge: COMIC_INK, shadow: COMIC_INK, shadowOnDark: COMIC_ORANGE },
};

// One size step below the landing's "medium": the sim's HUD and modal run
// tighter than a marketing page. "xs" is for persistent HUD controls.
const METRICS = {
  xs: { fontSize: "0.78rem", padding: "7px 14px", border: 2, shadow: 4, hoverShadow: 6 },
  small: { fontSize: "0.92rem", padding: "9px 20px", border: 3, shadow: 5, hoverShadow: 7 },
  medium: { fontSize: "1.15rem", padding: "13px 30px", border: 4, shadow: 7, hoverShadow: 10 },
};

/**
 * The landing's CTA button: flat face, thick ink keyline, hard offset
 * plate. Hover lifts the face off the plate; pressing sinks it flat onto
 * it. `variant="outline"` is the ghost tier - a bare keyline that earns
 * its fill and plate on hover. Set `onDark` on ink grounds so the plate
 * swaps to the scheme's acid colour.
 */
export function ComicButton({
  children,
  href,
  target,
  rel,
  onClick,
  variant = "filled",
  scheme = "orange",
  size = "small",
  onDark = false,
  sx,
  ...rest
}) {
  const colors = SCHEMES[scheme];
  const metrics = METRICS[size];
  const plate = onDark ? colors.shadowOnDark : colors.shadow;
  const isOutline = variant === "outline";

  const restShadow = `${metrics.shadow}px ${metrics.shadow}px 0 ${plate}`;
  const hoverShadow = `${metrics.hoverShadow}px ${metrics.hoverShadow}px 0 ${plate}`;
  const pressedShadow = `0px 0px 0 ${plate}`;

  const rootSx = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5em",
    boxSizing: "border-box",
    fontFamily: ANTON,
    fontWeight: 400,
    fontSize: metrics.fontSize,
    lineHeight: 1.15,
    whiteSpace: "nowrap",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    textDecoration: "none",
    textAlign: "center",
    padding: metrics.padding,
    border: `${metrics.border}px solid`,
    borderRadius: 0,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    userSelect: "none",
    transition:
      "transform 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease, color 0.12s ease",
    ...(isOutline
      ? {
          background: "transparent",
          color: colors.bg,
          borderColor: colors.bg,
          boxShadow: "none",
          "&:hover": {
            background: colors.bg,
            color: colors.text,
            borderColor: colors.edge,
            transform: "translate(-2px, -2px)",
            boxShadow: restShadow,
          },
          "&:active": {
            background: colors.bg,
            color: colors.text,
            borderColor: colors.edge,
            transform: "translate(2px, 2px)",
            boxShadow: pressedShadow,
          },
        }
      : {
          background: colors.bg,
          color: colors.text,
          borderColor: colors.edge,
          boxShadow: restShadow,
          "&:hover": {
            transform: "translate(-2px, -2px)",
            boxShadow: hoverShadow,
          },
          "&:active": {
            transform: `translate(${metrics.shadow}px, ${metrics.shadow}px)`,
            boxShadow: pressedShadow,
          },
        }),
    "&:focus-visible": {
      outline: `3px dashed ${onDark ? CREAM : COMIC_INK}`,
      outlineOffset: "5px",
    },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  };

  const combinedSx = [rootSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])];

  return href ? (
    <Box component="a" href={href} target={target} rel={rel} onClick={onClick} sx={combinedSx} {...rest}>
      {children}
    </Box>
  ) : (
    <Box component="button" type="button" onClick={onClick} sx={combinedSx} {...rest}>
      {children}
    </Box>
  );
}

// The MTV stack's knocked-askew per-line rotation cycle, in degrees.
const ROTATIONS = [-1.5, 0.75, -1];

/**
 * FancyTitle, compressed: stacked Anton lines with the landing's two
 * recipes. `tone="light"` (the cartridge label's cream ground) prints ink
 * fill over a hard accent drop plate, outline echoes in bare ink;
 * `tone="dark"` adds the cyan/magenta chromatic ghosts. Lines:
 * `{ text, variant: "fill" | "outline", color?, scale? }` or plain strings.
 */
export function ComicTitle({ component = "h2", tone = "light", accent = COMIC_ORANGE, fontSize = "2.4rem", lines, sx }) {
  const list = lines.map((l) => (typeof l === "string" ? { text: l } : l));
  const lineSx = (line, i) => {
    const rotate = ROTATIONS[i % ROTATIONS.length];
    const outline = line.variant === "outline";
    if (tone === "dark") {
      return outline
        ? {
            color: "transparent",
            WebkitTextStroke: `0.032em ${line.color ?? "#ffffff"}`,
            textShadow: `-0.03em 0 0 ${ACID_MAGENTA}`,
            transform: `rotate(${rotate}deg)`,
          }
        : {
            color: line.color ?? accent,
            textShadow: `0.06em 0.06em 0 ${COMIC_INK}, -0.035em 0 0 ${ACID_CYAN}, 0.035em 0 0 ${ACID_MAGENTA}`,
            transform: `rotate(${rotate}deg)`,
          };
    }
    return outline
      ? {
          color: "transparent",
          WebkitTextStroke: `0.03em ${line.color ?? COMIC_INK}`,
          transform: `rotate(${rotate}deg)`,
        }
      : {
          color: line.color ?? COMIC_INK,
          textShadow: `0.05em 0.05em 0 ${accent}`,
          transform: `rotate(${rotate}deg)`,
        };
  };
  return (
    <Box
      component={component}
      sx={[
        {
          m: 0,
          fontFamily: ANTON,
          fontWeight: 400,
          lineHeight: 0.95,
          letterSpacing: "normal",
          textTransform: "uppercase",
          fontSize,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {list.map((line, i) => (
        <Box
          key={i}
          component="span"
          className="comic-title-line"
          sx={{
            display: "block",
            ...(line.scale ? { fontSize: `${line.scale}em` } : {}),
            ...lineSx(line, i),
          }}
        >
          {line.text}
        </Box>
      ))}
    </Box>
  );
}

// Where the ink pools: the ramp runs from that corner/edge toward the
// opposite one (gradient start = densest dots).
const RAMP_DIRECTIONS = {
  top: "to bottom",
  bottom: "to top",
  "top-left": "to bottom right",
  "top-right": "to bottom left",
  "bottom-left": "to top right",
  "bottom-right": "to top left",
};

/**
 * Halftone dot ramp, ported from the landing's HalftoneBackdrop: one layer
 * per dot size, each masked by a triangle band centred on its own slice of
 * the ramp, so the screen frequency never changes - only the dots grow
 * toward the `corner`. Decorative only: absolutely positioned over its
 * nearest positioned ancestor, pointer-transparent.
 */
export function HalftoneRamp({
  color = "rgba(16, 16, 24, 0.06)",
  size = 14,
  corner = "bottom",
  reach = 55,
  dots = [3.1, 2.55, 2.05, 1.6, 1.15, 0.7],
  sx,
}) {
  const towards = RAMP_DIRECTIONS[corner];
  const band = reach / dots.length;
  return (
    <Box
      aria-hidden
      sx={[
        { position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {dots.map((radius, i) => {
        const centre = band * i;
        const mask =
          i === 0
            ? `linear-gradient(${towards}, #000 0%, transparent ${centre + band}%)`
            : `linear-gradient(${towards}, transparent ${centre - band}%, #000 ${centre}%, transparent ${centre + band}%)`;
        return (
          <Box
            key={radius}
            sx={{
              position: "absolute",
              inset: 0,
              backgroundImage: `radial-gradient(${color} ${radius}px, transparent ${radius + 0.7}px)`,
              backgroundSize: `${size}px ${size}px`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
    </Box>
  );
}
