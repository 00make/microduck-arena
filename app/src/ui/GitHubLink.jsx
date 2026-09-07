// GitHub repo link for the title screens' corner chrome: a mini HUD plate
// (cream keyline over dark glass, same print language as the in-game HUD
// panels) with the octocat mark inline - no icon dependency. It stacks
// under the top-right shop plate so the corner reads SHOP / CODE as one
// column. Hover swaps the hard offset plate to acid magenta, matching the
// comic buttons' on-dark accent; pressing sinks the face flat onto it.
import Box from "@mui/material/Box";
import { ACID_MAGENTA } from "./comic.jsx";

export const REPO_URL = "https://github.com/00make/microduck-arena";

// The HUD plate's geometry (Hud.jsx keeps its metrics private): 48px tall
// frame at top 1.25rem, "Shop" cartouche hanging ~9px over the corner -
// this spot clears both with a little air.
const SPOT = {
  position: "absolute",
  top: { xs: "5rem", md: "5.15rem" },
  right: "1.5rem",
  zIndex: 1,
};

const FRAME = "rgba(250, 248, 242, 0.9)";
const GLASS = "rgba(8, 8, 12, 0.6)";

export function GitHubLink({ sx }) {
  return (
    <Box
      component="a"
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Microduck Arena source on GitHub (opens in a new tab)"
      sx={{
        ...SPOT,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "48px",
        height: "48px",
        boxSizing: "border-box",
        border: `2px solid ${FRAME}`,
        borderRadius: 0,
        background: GLASS,
        boxShadow: `2px 2px 0 ${ACID_MAGENTA}`,
        color: "#fff",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        transition:
          "transform 0.12s ease, box-shadow 0.12s ease, color 0.12s ease",
        "&:hover": {
          color: ACID_MAGENTA,
          transform: "translate(-1px, -1px) scale(1.06)",
          boxShadow: `4px 4px 0 ${ACID_MAGENTA}`,
        },
        "&:active": {
          transform: "translate(2px, 2px)",
          boxShadow: `0 0 0 ${ACID_MAGENTA}`,
        },
        "&:focus-visible": {
          outline: "3px dashed #faf8f2",
          outlineOffset: "4px",
        },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        ...sx,
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 16 16"
        aria-hidden
        fill="currentColor"
        sx={{ display: "block", width: "28px", height: "28px" }}
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </Box>
    </Box>
  );
}

export default GitHubLink;
