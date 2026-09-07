// Coach tactics panel for football mode: pick side, formation, style, press.
// Style/press apply live; formation is locked after Kick Off (parent passes
// formationLocked). Pure UI — writes through gameApi when booted, else store.
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useGame, gameApi } from "../store.js";
import { MONO, ORANGE } from "../theme.js";
import { ANTON, CREAM, COMIC_INK } from "../ui/comic.jsx";
import {
  DEFAULT_STRATEGY,
  FORMATION_IDS,
  STYLE_IDS,
  PRESS_IDS,
  normalizeStrategy,
} from "../game/football/strategy.js";
import {
  t,
  formationLabel,
  styleLabel,
  pressLabel,
  teamLabel,
} from "./i18n.js";

const RED_ACCENT = "#ff4466";
const BLUE_ACCENT = "#4488ff";

function patchStrategy(partial, opts) {
  if (typeof gameApi.setTeamStrategy === "function") {
    return gameApi.setTeamStrategy(partial, opts);
  }
  const prev = useGame.getState().userStrategy || DEFAULT_STRATEGY;
  const next = normalizeStrategy({ ...prev, ...partial });
  useGame.setState({ userStrategy: next });
  return next;
}

function patchTeam(team) {
  if (typeof gameApi.setUserTeam === "function") {
    return gameApi.setUserTeam(team);
  }
  useGame.setState({ userTeam: team });
  return team;
}

function ChipGroup({ label, options, labels, value, onChange, disabled }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "stretch" }}>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: "0.58rem",
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
          textAlign: "left",
        }}
      >
        {label}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        {options.map((id) => {
          const on = value === id;
          return (
            <Box
              key={id}
              component="button"
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(id)}
              sx={{
                appearance: "none",
                cursor: disabled ? "default" : "pointer",
                border: `2px solid ${on ? ORANGE : "rgba(255,255,255,0.22)"}`,
                borderRadius: 0,
                background: on ? "rgba(255,122,47,0.18)" : "rgba(0,0,0,0.25)",
                color: on ? CREAM : "rgba(255,255,255,0.72)",
                fontFamily: ANTON,
                fontSize: "0.72rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                lineHeight: 1,
                px: "0.65rem",
                py: "0.45rem",
                opacity: disabled ? 0.45 : 1,
                transition: "border-color 0.12s ease, background 0.12s ease",
                WebkitTapHighlightColor: "transparent",
                "&:hover": disabled ? undefined : { borderColor: ORANGE },
                "&:focus-visible": {
                  outline: `2px dashed ${CREAM}`,
                  outlineOffset: 2,
                },
              }}
            >
              {labels[id] || id}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * @param {{ compact?: boolean, formationLocked?: boolean }} props
 */
export default function StrategyPanel({ compact = false, formationLocked = false }) {
  const userTeam = useGame((s) => s.userTeam) || "red";
  const userStrategy = useGame((s) => s.userStrategy) || DEFAULT_STRATEGY;
  const locale = useGame((s) => s.locale) || "en";
  const strat = normalizeStrategy(userStrategy);

  const formationLabels = Object.fromEntries(
    FORMATION_IDS.map((id) => [id, formationLabel(locale, id)]),
  );
  const styleLabels = Object.fromEntries(
    STYLE_IDS.map((id) => [id, styleLabel(locale, id)]),
  );
  const pressLabels = Object.fromEntries(
    PRESS_IDS.map((id) => [id, pressLabel(locale, id)]),
  );

  return (
    <Box
      role="group"
      aria-label={t(locale, "teamTactics")}
      sx={{
        width: "100%",
        maxWidth: compact ? "22rem" : "28rem",
        mx: "auto",
        mt: compact ? 0 : "1.35rem",
        p: compact ? "0.75rem 0.85rem" : "0.95rem 1.05rem",
        border: `2px solid rgba(255,255,255,0.14)`,
        boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
        background: "rgba(16,16,24,0.72)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? "0.65rem" : "0.85rem",
        textAlign: "left",
      }}
    >
      <Typography
        sx={{
          fontFamily: ANTON,
          fontSize: compact ? "0.78rem" : "0.9rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: CREAM,
        }}
      >
        {t(locale, "coachDesk")}
      </Typography>

      <ChipGroup
        label={t(locale, "yourSide")}
        options={["red", "blue"]}
        labels={{ red: teamLabel(locale, "red"), blue: teamLabel(locale, "blue") }}
        value={userTeam}
        onChange={(tm) => patchTeam(tm)}
        disabled={formationLocked}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : { xs: "1fr", sm: "1fr 1fr" },
          gap: compact ? "0.65rem" : "0.85rem 1rem",
        }}
      >
        <ChipGroup
          label={t(locale, "formation")}
          options={FORMATION_IDS}
          labels={formationLabels}
          value={strat.formation}
          disabled={formationLocked}
          onChange={(formation) => patchStrategy({ formation })}
        />
        <ChipGroup
          label={t(locale, "style")}
          options={STYLE_IDS}
          labels={styleLabels}
          value={strat.style}
          onChange={(style) => patchStrategy({ style })}
        />
        <ChipGroup
          label={t(locale, "press")}
          options={PRESS_IDS}
          labels={pressLabels}
          value={strat.press}
          onChange={(press) => patchStrategy({ press })}
        />
      </Box>

      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: "0.56rem",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: userTeam === "red" ? RED_ACCENT : BLUE_ACCENT,
        }}
      >
        {teamLabel(locale, userTeam)} · {formationLabels[strat.formation]} · {styleLabels[strat.style]} · {t(locale, "pressWord")} {pressLabels[strat.press]}
        {formationLocked ? ` · ${t(locale, "formationLocked")}` : ""}
      </Typography>
    </Box>
  );
}
