// Live cumulative match report — possession tug + shots + strategy tags.
import Box from "@mui/material/Box";
import { useGame } from "../store.js";
import { uiClick } from "../game/audio.js";
import { MONO } from "../theme.js";
import { ANTON, CREAM, COMIC_INK } from "../ui/comic.jsx";
import { DEFAULT_STRATEGY, normalizeStrategy } from "../game/football/strategy.js";
import {
  t,
  formationLabel,
  strategyTag,
  teamLabel,
} from "./i18n.js";

const RED_ACCENT = "#ff4466";
const BLUE_ACCENT = "#4488ff";
const GLASS = "rgba(16, 16, 24, 0.88)";

function PossBar({ redPct, locale }) {
  const pct = Math.round(clamp01(redPct) * 100);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: MONO,
          fontSize: "0.52rem",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        <Box component="span" sx={{ color: RED_ACCENT }}>{pct}%</Box>
        <Box component="span">{t(locale, "boardPoss")}</Box>
        <Box component="span" sx={{ color: BLUE_ACCENT }}>{100 - pct}%</Box>
      </Box>
      <Box
        sx={{
          display: "flex",
          height: 8,
          border: "1px solid rgba(255,255,255,0.18)",
          overflow: "hidden",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <Box
          sx={{
            width: `${pct}%`,
            background: RED_ACCENT,
            transition: "width 0.35s ease",
          }}
        />
        <Box
          sx={{
            flex: 1,
            background: BLUE_ACCENT,
            transition: "width 0.35s ease",
          }}
        />
      </Box>
    </Box>
  );
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function TeamTags({ team, strategy, locale, isUser, onOpenCoach }) {
  const accent = team === "red" ? RED_ACCENT : BLUE_ACCENT;
  const strat = normalizeStrategy(strategy || DEFAULT_STRATEGY);
  const line = [
    formationLabel(locale, strat.formation),
    strategyTag(locale, strat),
  ].join(" · ");

  return (
    <Box
      sx={{
        flex: "1 1 0",
        minWidth: 0,
        border: `2px solid ${accent}`,
        boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
        background: GLASS,
        p: { xs: "0.35rem 0.4rem", sm: "0.45rem 0.55rem" },
        pointerEvents: isUser ? "auto" : "none",
        cursor: isUser ? "pointer" : "default",
      }}
      onClick={isUser ? onOpenCoach : undefined}
      role={isUser ? "button" : undefined}
      tabIndex={isUser ? 0 : undefined}
      aria-label={isUser ? t(locale, "openCoach") : undefined}
      onKeyDown={isUser ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenCoach?.();
        }
      } : undefined}
    >
      <Box
        sx={{
          fontFamily: ANTON,
          fontSize: { xs: "0.62rem", sm: "0.72rem" },
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: accent,
          lineHeight: 1.1,
          mb: "0.2rem",
        }}
      >
        {teamLabel(locale, team)}
      </Box>
      <Box
        sx={{
          fontFamily: MONO,
          fontSize: { xs: "0.46rem", sm: "0.52rem" },
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: CREAM,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {line}
      </Box>
    </Box>
  );
}

/**
 * Bottom report: red tags | possession + shots | blue tags.
 * Click user side to reopen coach desk.
 */
export default function StrategyBoard() {
  const entered = useGame((s) => s.entered);
  const menuOpen = useGame((s) => s.menuOpen);
  const matchState = useGame((s) => s.matchState);
  const locale = useGame((s) => s.locale) || "en";
  const userTeam = useGame((s) => s.userTeam) || "red";
  const board = useGame((s) => s.tacticsBoard);

  // Hide under the fulltime tactics card — avoid duplicating the same numbers.
  if (!entered || menuOpen || matchState === "FULLTIME") return null;

  const openCoach = () => {
    uiClick();
    useGame.setState({ menuOpen: true });
  };

  const redPct = board?.possession?.redPct ?? 0.5;
  const shotsR = board?.shots?.red ?? 0;
  const shotsB = board?.shots?.blue ?? 0;

  return (
    <Box
      sx={{
        position: "fixed",
        left: "50%",
        bottom: { xs: "calc(0.45rem + env(safe-area-inset-bottom, 0px))", sm: "0.85rem" },
        transform: "translateX(-50%)",
        zIndex: 10,
        width: { xs: "calc(100vw - 0.9rem)", sm: "min(44rem, calc(100vw - 1.5rem))" },
        display: "flex",
        flexDirection: "column",
        gap: { xs: "0.25rem", sm: "0.4rem" },
        pointerEvents: "none",
        "& > *": { pointerEvents: "auto" },
      }}
    >
      <Box
        sx={{
          border: `2px solid ${COMIC_INK}`,
          background: GLASS,
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08)`,
          p: { xs: "0.3rem 0.45rem 0.35rem", sm: "0.5rem 0.7rem 0.55rem" },
          display: "flex",
          flexDirection: { xs: "row", sm: "column" },
          alignItems: { xs: "center", sm: "stretch" },
          gap: { xs: "0.55rem", sm: "0.4rem" },
        }}
      >
        <Box sx={{ flex: { xs: "1 1 0", sm: "none" }, minWidth: 0, width: { sm: "100%" } }}>
          <PossBar redPct={redPct} locale={locale} />
        </Box>
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "baseline",
            gap: "0.35rem",
            fontFamily: ANTON,
            fontSize: { xs: "0.82rem", sm: "0.95rem" },
            letterSpacing: "0.08em",
            color: CREAM,
            lineHeight: 1,
            flex: "none",
          }}
        >
          <Box component="span" sx={{ color: RED_ACCENT }}>{shotsR}</Box>
          <Box
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: { xs: "0.42rem", sm: "0.5rem" },
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            {t(locale, "boardShots")}
          </Box>
          <Box component="span" sx={{ color: BLUE_ACCENT }}>{shotsB}</Box>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: "0.35rem" }}>
        <TeamTags
          team="red"
          strategy={board?.strategy?.red}
          locale={locale}
          isUser={userTeam === "red"}
          onOpenCoach={openCoach}
        />
        <TeamTags
          team="blue"
          strategy={board?.strategy?.blue}
          locale={locale}
          isUser={userTeam === "blue"}
          onOpenCoach={openCoach}
        />
      </Box>
    </Box>
  );
}
