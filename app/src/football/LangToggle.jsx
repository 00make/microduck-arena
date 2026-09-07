// EN / 中 toggle for football title & pause overlay.
import Box from "@mui/material/Box";
import { useGame } from "../store.js";
import { ORANGE, MONO } from "../theme.js";
import { ANTON, CREAM, COMIC_INK } from "../ui/comic.jsx";
import { persistLocale, t } from "./i18n.js";

export default function LangToggle({ sx }) {
  const locale = useGame((s) => s.locale) || "en";

  const setLocale = (next) => {
    if (next === locale) return;
    persistLocale(next);
    useGame.setState({ locale: next });
  };

  const chip = (id, label) => {
    const on = locale === id;
    return (
      <Box
        key={id}
        component="button"
        type="button"
        aria-pressed={on}
        aria-label={id === "en" ? "English" : "中文"}
        onClick={() => setLocale(id)}
        sx={{
          appearance: "none",
          cursor: "pointer",
          border: `2px solid ${on ? ORANGE : "rgba(255,255,255,0.22)"}`,
          borderRadius: 0,
          background: on ? "rgba(255,122,47,0.2)" : "rgba(0,0,0,0.35)",
          color: on ? CREAM : "rgba(255,255,255,0.7)",
          fontFamily: id === "zh" ? MONO : ANTON,
          fontSize: "0.72rem",
          fontWeight: 700,
          letterSpacing: id === "en" ? "0.08em" : "0.02em",
          lineHeight: 1,
          minWidth: "2.1rem",
          px: "0.5rem",
          py: "0.4rem",
          transition: "border-color 0.12s ease, background 0.12s ease",
          WebkitTapHighlightColor: "transparent",
          "&:hover": { borderColor: ORANGE },
          "&:focus-visible": {
            outline: `2px dashed ${CREAM}`,
            outlineOffset: 2,
          },
        }}
      >
        {label}
      </Box>
    );
  };

  return (
    <Box
      role="group"
      aria-label="Language"
      sx={{
        position: "absolute",
        top: { xs: "8.6rem", md: "8.75rem" },
        right: "1.5rem",
        zIndex: 2,
        display: "inline-flex",
        gap: "0.3rem",
        p: "0.25rem",
        border: "2px solid rgba(255,255,255,0.14)",
        boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
        background: "rgba(16,16,24,0.72)",
        ...sx,
      }}
    >
      {chip("en", t(locale, "langEn"))}
      {chip("zh", t(locale, "langZh"))}
    </Box>
  );
}
