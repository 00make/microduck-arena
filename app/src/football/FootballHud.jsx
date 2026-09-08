// Football match HUD: scoreboard, timer, match state, and event ticker.
// Follows the existing comic/arcade aesthetic (Anton, ink/cream/orange
// palette, zero-radius panel plates with cream keyline frames).
import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";
import { useGame, gameApi } from "../store.js";
import { uiClick } from "../game/audio.js";
import { ORANGE, MONO } from "../theme.js";
import { ANTON, COMIC_INK, CREAM, COMIC_ORANGE } from "../ui/comic.jsx";
import { GitHubLink } from "../ui/GitHubLink.jsx";
import { formatClock, stateLabel, eventLabel, recentEvents } from "./hud-logic.js";
import { t, teamLabel, strategyTag } from "./i18n.js";
import CommentaryDanmaku from "./CommentaryDanmaku.jsx";
import StrategyBoard from "./StrategyBoard.jsx";
import TeamFpv from "./TeamFpv.jsx";

// ── Design tokens (shared with Hud.jsx language) ──────────────────────────
const FRAME_W = 2;
const GLASS = "rgba(16, 16, 24, 0.85)";
const FRAME = COMIC_ORANGE;
// Team accent hues for the score line / sin-bin chips (brighter than the
// variant shell colours so they read on the dark glass plate).
const RED_ACCENT = "#ff4466";
const BLUE_ACCENT = "#4488ff";

// ── Animations ────────────────────────────────────────────────────────────
const fadeSlideUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const pulseGlow = keyframes`
  0%, 100% { text-shadow: 0 0 8px rgba(255, 122, 47, 0.5); }
  50%      { text-shadow: 0 0 18px rgba(255, 122, 47, 0.9); }
`;

const goalFlash = keyframes`
  0%   { opacity: 1; transform: scale(1.15); }
  50%  { opacity: 0.7; transform: scale(1.0); }
  100% { opacity: 1; transform: scale(1.05); }
`;

// Slam-in for the full-time result sticker: overshoots slightly, then
// settles on a tilted "slap" angle. The static sx rotate only shows if the
// animation is reduced away; with `both` fill the keyframes own the tilt.
const slamIn = keyframes`
  0%   { opacity: 0; transform: scale(2.1) rotate(7.5deg); }
  60%  { opacity: 1; transform: scale(0.94) rotate(-0.9deg); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
`;

const vignetteIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

// ── Panel plate (simplified from Hud.jsx's HudPlate for the scoreboard) ───
const scorePlateSx = {
  position: "relative",
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  boxSizing: "border-box",
  border: `${FRAME_W}px solid ${FRAME}`,
  borderRadius: 0,
  background: GLASS,
  padding: "10px 24px 8px",
  minWidth: 240,
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 2,
    boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
  },
};

// ── Sub-components ────────────────────────────────────────────────────────

function BackArrowIcon() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      sx={{ width: "0.95em", height: "0.95em", display: "block", flex: "none" }}
    >
      <path d="M20 12H6" />
      <path d="M12 5l-7 7 7 7" />
    </Box>
  );
}

function BackButton() {
  const locale = useGame((s) => s.locale) || "en";
  return (
    <Box
      sx={{
        position: "fixed",
        top: { xs: "0.55rem", sm: "1.25rem" },
        left: { xs: "0.5rem", sm: "1.5rem" },
        zIndex: 12,
        pointerEvents: "auto",
        display: "flex",
        flexWrap: "nowrap",
        maxWidth: { xs: "calc(100vw - 3.5rem)", sm: "none" },
        gap: { xs: "0.28rem", sm: "0.45rem" },
      }}
    >
      <Box
        sx={{
          ...scorePlateSx,
          flexDirection: "row",
          minWidth: "unset",
          padding: { xs: "5px 8px", sm: "6px 14px" },
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label={t(locale, "back")}
          onClick={() => { uiClick(); useGame.setState({ menuOpen: true }); }}
          sx={{
            appearance: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45em",
            border: "none",
            borderRadius: 0,
            background: "transparent",
            color: CREAM,
            cursor: "pointer",
            fontFamily: ANTON,
            fontSize: { xs: "0.72rem", sm: "0.82rem" },
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            lineHeight: 1,
            whiteSpace: "nowrap",
            WebkitTapHighlightColor: "transparent",
            userSelect: "none",
            transition: "color 0.15s ease",
            "&:hover": { color: ORANGE },
            "&:active": { filter: "brightness(0.92)" },
            "&:focus-visible": {
              outline: `2px dashed ${CREAM}`,
              outlineOffset: -3,
            },
          }}
        >
          <BackArrowIcon />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            {t(locale, "back")}
          </Box>
        </Box>
      </Box>
      <DanmakuToggleButton />
      <SpeedToggleButton />
    </Box>
  );
}

function DanmakuToggleButton() {
  const locale = useGame((s) => s.locale) || "en";
  const enabled = useGame((s) => s.danmakuEnabled !== false);
  return (
    <Box
      sx={{
        ...scorePlateSx,
        flexDirection: "row",
        minWidth: "unset",
        padding: { xs: "5px 8px", sm: "6px 12px" },
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label={enabled ? t(locale, "danmakuOff") : t(locale, "danmakuOn")}
        aria-pressed={enabled}
        onClick={() => {
          const next = !enabled;
          useGame.setState({ danmakuEnabled: next });
          try { localStorage.setItem("microduck-danmaku", next ? "1" : "0"); } catch { /* private mode */ }
          uiClick();
        }}
        sx={{
          appearance: "none",
          border: "none",
          background: "transparent",
          color: enabled ? CREAM : "rgba(250,248,242,0.45)",
          cursor: "pointer",
          fontFamily: MONO,
          fontSize: { xs: "0.55rem", sm: "0.65rem" },
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          lineHeight: 1,
          "&:hover": { color: ORANGE },
        }}
      >
        {enabled ? t(locale, "danmakuOn") : t(locale, "danmakuOff")}
      </Box>
    </Box>
  );
}

function SpeedToggleButton() {
  const locale = useGame((s) => s.locale) || "en";
  const simSpeed = useGame((s) => s.simSpeed) || 1;
  const n = simSpeed === 2 || simSpeed === 3 ? simSpeed : 1;
  return (
    <Box
      sx={{
        ...scorePlateSx,
        flexDirection: "row",
        minWidth: "unset",
        padding: { xs: "5px 8px", sm: "6px 12px" },
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label={t(locale, "speedAria", { n: String(n) })}
        onClick={() => {
          if (typeof gameApi.cycleSimSpeed === "function") {
            gameApi.cycleSimSpeed();
          } else {
            const cur = useGame.getState().simSpeed;
            const next = cur >= 3 ? 1 : (Number(cur) || 1) + 1;
            useGame.setState({ simSpeed: next });
            try { localStorage.setItem("microduck-sim-speed", String(next)); } catch { /* private */ }
          }
          uiClick();
        }}
        sx={{
          appearance: "none",
          border: "none",
          background: "transparent",
          color: n > 1 ? ORANGE : CREAM,
          cursor: "pointer",
          fontFamily: MONO,
          fontSize: { xs: "0.55rem", sm: "0.65rem" },
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          lineHeight: 1,
          minWidth: "2.4em",
          "&:hover": { color: ORANGE },
        }}
      >
        {t(locale, "speedLabel", { n: String(n) })}
      </Box>
    </Box>
  );
}

function Scoreboard() {
  const score = useGame((s) => s.score);
  const matchTime = useGame((s) => s.matchTime);
  const matchState = useGame((s) => s.matchState);
  const locale = useGame((s) => s.locale) || "en";

  const red = score?.red ?? 0;
  const blue = score?.blue ?? 0;
  const time = formatClock(matchTime ?? 0);
  const label = stateLabel(matchState, locale);
  const isGoal = matchState === "GOAL";

  return (
    <Box
      sx={{
        position: "fixed",
        // Phones: sit under the chrome row so Back / 弹幕 / GitHub never collide.
        top: { xs: "2.85rem", sm: "1.25rem" },
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 11,
        pointerEvents: "none",
        maxWidth: { xs: "min(14rem, calc(100vw - 1.2rem))", sm: "none" },
      }}
    >
      <Box
        sx={{
          ...scorePlateSx,
          minWidth: { xs: 0, sm: 240 },
          width: { xs: "100%", sm: "auto" },
          padding: { xs: "5px 14px 4px", sm: "10px 24px 8px" },
        }}
      >
        {/* Score line */}
        <Box
          sx={{
            fontFamily: ANTON,
            fontSize: { xs: "1.05rem", sm: "1.6rem" },
            lineHeight: 1,
            letterSpacing: "0.04em",
            color: CREAM,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: { xs: "0.28em", sm: "0.5em" },
            animation: isGoal
              ? `${goalFlash} 0.6s ease infinite`
              : "none",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          <Box component="span" sx={{ color: RED_ACCENT, display: { xs: "none", sm: "inline" } }}>RED</Box>
          <Box component="span" sx={{ color: RED_ACCENT, display: { xs: "inline", sm: "none" }, fontSize: "0.72em" }}>R</Box>
          <Box component="span" sx={{ color: CREAM }}>{red}</Box>
          <Box component="span" sx={{ color: "rgba(250,248,242,0.4)", mx: "0.1em" }}>—</Box>
          <Box component="span" sx={{ color: CREAM }}>{blue}</Box>
          <Box component="span" sx={{ color: BLUE_ACCENT, display: { xs: "none", sm: "inline" } }}>BLUE</Box>
          <Box component="span" sx={{ color: BLUE_ACCENT, display: { xs: "inline", sm: "none" }, fontSize: "0.72em" }}>B</Box>
        </Box>

        {/* Timer */}
        <Box
          sx={{
            fontFamily: MONO,
            fontSize: { xs: "0.85rem", sm: "1.1rem" },
            letterSpacing: "0.12em",
            color: CREAM,
            mt: { xs: "2px", sm: "4px" },
            fontVariantNumeric: "tabular-nums",
            opacity: 0.9,
            textAlign: "center",
          }}
        >
          {time}
        </Box>

        {/* State label */}
        <Box
          sx={{
            fontFamily: ANTON,
            fontSize: { xs: "0.5rem", sm: "0.6rem" },
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            mt: { xs: "2px", sm: "4px" },
            color: isGoal ? COMIC_ORANGE : "rgba(250, 248, 242, 0.55)",
            animation: isGoal ? `${pulseGlow} 1s ease infinite` : "none",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            textAlign: "center",
          }}
        >
          {label}
        </Box>
      </Box>
    </Box>
  );
}

// ── Full-time result + tactics card ───────────────────────────────────────
// Reads store.matchResult ('red' | 'blue' | 'draw'), written by game.js on
// the fulltime event. tacticsCard freezes possession / shots / strategy tags.
export function MatchResultBanner() {
  const matchState = useGame((s) => s.matchState);
  const matchResult = useGame((s) => s.matchResult ?? null);
  const tacticsCard = useGame((s) => s.tacticsCard);
  const locale = useGame((s) => s.locale) || "en";
  if (matchState !== "FULLTIME" || !matchResult) return null;

  const win = matchResult === "red" || matchResult === "blue";
  const accent = matchResult === "red" ? RED_ACCENT : matchResult === "blue" ? BLUE_ACCENT : COMIC_ORANGE;
  const teamName = win ? teamLabel(locale, matchResult) : "";
  const headline = win
    ? (locale === "zh" ? `${teamName}胜` : `${matchResult.toUpperCase()} WINS`)
    : (locale === "zh" ? "平局" : "DRAW");
  const sub = win
    ? (locale === "zh" ? "全场结束 — 胜方" : "FULL TIME — MATCH WINNER")
    : (locale === "zh" ? "全场结束 — 双方战平" : "FULL TIME — HONOURS EVEN");

  const redTag = strategyTag(locale, tacticsCard?.strategy?.red);
  const blueTag = strategyTag(locale, tacticsCard?.strategy?.blue);
  const locoTag = tacticsCard?.loco === "rollers"
    ? t(locale, "locoRollers")
    : t(locale, "locoLegs");
  const shotsR = tacticsCard?.shots?.red ?? 0;
  const shotsB = tacticsCard?.shots?.blue ?? 0;
  const possPct = Math.round(clamp01(tacticsCard?.possession?.redPct ?? 0.5) * 100);
  const hasCard = !!tacticsCard;

  return (
    <>
      {/* Team-tinted edge vignette: the winner's colour bleeds into the frame */}
      <Box
        aria-hidden
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(130% 95% at 50% 42%, transparent 52%, ${accent}2e 100%)`,
          animation: `${vignetteIn} 0.5s ease both`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
      <Box
        role="status"
        aria-live="polite"
        sx={{
          position: "fixed",
          top: { xs: "5.5rem", sm: "8.75rem" },
          left: "50%",
          translate: "-50% 0",
          zIndex: 13,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: { xs: "0.45rem", sm: "0.65rem" },
          width: { xs: "calc(100vw - 1.25rem)", sm: "auto" },
          maxWidth: "28rem",
          rotate: { xs: "-0.6deg", sm: "-1.5deg" },
          animation: `${slamIn} 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) both`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        {/* Hard-offset sticker plate — comic slap, no soft blurs */}
        <Box
          sx={{
            position: "relative",
            boxSizing: "border-box",
            border: `${FRAME_W}px solid ${COMIC_INK}`,
            outline: `${FRAME_W}px solid ${accent}`,
            outlineOffset: 0,
            borderRadius: 0,
            background: GLASS,
            padding: { xs: "8px 16px 10px", sm: "10px 34px 12px" },
            width: { xs: "100%", sm: "auto" },
            boxSizing: "border-box",
            boxShadow: `7px 7px 0 ${COMIC_INK}, 7px 7px 0 2px ${accent}55`,
            "&::after": {
              content: '""',
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: `repeating-linear-gradient(-45deg, ${accent}14 0 6px, transparent 6px 12px)`,
            },
          }}
        >
          <Box
            sx={{
              fontFamily: ANTON,
              fontSize: "clamp(1.35rem, 7vw, 3.1rem)",
              lineHeight: 0.95,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: win ? accent : CREAM,
              textShadow: win
                ? `3px 3px 0 ${COMIC_INK}`
                : `3px 3px 0 ${COMIC_INK}, 3px 3px 0 ${COMIC_ORANGE}66`,
              whiteSpace: { xs: "normal", sm: "nowrap" },
              textAlign: "center",
            }}
          >
            {headline}
          </Box>
          <Box
            sx={{
              fontFamily: MONO,
              fontSize: "0.62rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(250, 248, 242, 0.65)",
              mt: "8px",
              textAlign: "center",
            }}
          >
            {sub}
          </Box>
        </Box>

        {hasCard ? (
          <Box
            sx={{
              position: "relative",
              boxSizing: "border-box",
              border: `${FRAME_W}px solid ${COMIC_INK}`,
              background: GLASS,
              padding: "12px 22px 14px",
              minWidth: "min(22rem, calc(100vw - 2.5rem))",
              maxWidth: "28rem",
              boxShadow: `5px 5px 0 ${COMIC_INK}`,
              rotate: "1.2deg",
            }}
          >
            <Box
              sx={{
                fontFamily: MONO,
                fontSize: "0.5rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(250,248,242,0.5)",
                textAlign: "center",
                mb: "0.55rem",
              }}
            >
              {t(locale, "cardSub")}
            </Box>
            <Box
              sx={{
                fontFamily: ANTON,
                fontSize: "clamp(0.95rem, 2.8vw, 1.25rem)",
                letterSpacing: "0.04em",
                textAlign: "center",
                lineHeight: 1.25,
                color: CREAM,
                mb: "0.65rem",
              }}
            >
              <Box component="span" sx={{ color: RED_ACCENT }}>{redTag}</Box>
              <Box
                component="span"
                sx={{
                  mx: "0.45rem",
                  fontFamily: MONO,
                  fontSize: "0.55rem",
                  color: "rgba(255,255,255,0.4)",
                  verticalAlign: "middle",
                }}
              >
                {t(locale, "boardVs")}
              </Box>
              <Box component="span" sx={{ color: BLUE_ACCENT }}>{blueTag}</Box>
              <Box
                component="div"
                sx={{
                  mt: "0.35rem",
                  fontFamily: MONO,
                  fontSize: "0.52rem",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                {t(locale, "locoMode")} · {locoTag}
              </Box>
            </Box>
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                gap: "1.2rem",
                fontFamily: MONO,
                fontSize: "0.72rem",
                letterSpacing: "0.06em",
                color: CREAM,
              }}
            >
              <Box component="span">
                {t(locale, "boardShots")}{" "}
                <Box component="span" sx={{ color: RED_ACCENT, fontFamily: ANTON, fontSize: "1.05rem" }}>
                  {shotsR}
                </Box>
                –
                <Box component="span" sx={{ color: BLUE_ACCENT, fontFamily: ANTON, fontSize: "1.05rem" }}>
                  {shotsB}
                </Box>
              </Box>
              <Box component="span">
                {t(locale, "boardPoss")}{" "}
                <Box component="span" sx={{ color: RED_ACCENT, fontFamily: ANTON, fontSize: "1.05rem" }}>
                  {possPct}%
                </Box>
              </Box>
            </Box>
          </Box>
        ) : null}
      </Box>
    </>
  );
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function EventTicker() {
  const matchEvents = useGame((s) => s.matchEvents);
  const locale = useGame((s) => s.locale) || "en";
  const events = recentEvents(matchEvents, 3);

  if (events.length === 0) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        // Sit just above the bottom strategy board (shorter on phones).
        bottom: {
          xs: "calc(5.6rem + env(safe-area-inset-bottom, 0px))",
          sm: "11.5rem",
        },
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        maxWidth: "calc(100vw - 1rem)",
      }}
    >
      {events.map((ev, i) => (
        <Box
          key={`${ev.type}-${ev.time}-${i}`}
          sx={{
            fontFamily: MONO,
            fontSize: { xs: "0.58rem", sm: "0.7rem" },
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: CREAM,
            background: "rgba(16, 16, 24, 0.75)",
            border: `1px solid rgba(255, 122, 47, 0.35)`,
            borderRadius: 0,
            padding: { xs: "3px 8px", sm: "4px 12px" },
            whiteSpace: "nowrap",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: 1 - i * 0.25,
            animation: `${fadeSlideUp} 0.3s ease both`,
            animationDelay: `${i * 0.08}s`,
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
              opacity: 1 - i * 0.2,
            },
          }}
        >
          {eventLabel(ev, locale)}
        </Box>
      ))}
    </Box>
  );
}

function PenaltyIndicator() {
  const ducksState = useGame((s) => s.ducksState);
  const locale = useGame((s) => s.locale) || "en";
  if (!ducksState) return null;
  const penalized = ducksState.filter((d) => d.penalized);
  if (penalized.length === 0) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        top: { xs: "auto", sm: "17.5rem" },
        bottom: { xs: "calc(7.6rem + env(safe-area-inset-bottom, 0px))", sm: "auto" },
        right: { xs: "0.55rem", sm: "1.25rem" },
        left: "auto",
        transform: "none",
        zIndex: 12,
        pointerEvents: "none",
        display: "flex",
        gap: "8px",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      {penalized.map((d) => (
        <Box
          key={d.id}
          sx={{
            fontFamily: MONO,
            fontSize: "0.6rem",
            letterSpacing: "0.1em",
            color: d.team === "red" ? RED_ACCENT : BLUE_ACCENT,
            background: "rgba(16, 16, 24, 0.8)",
            border: `1px solid ${d.team === "red" ? "rgba(255,68,102,0.4)" : "rgba(68,136,255,0.4)"}`,
            padding: "3px 8px",
            textTransform: "uppercase",
          }}
        >
          #{d.id} {t(locale, "sinBin")}
        </Box>
      ))}
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────
export default function FootballHud() {
  const entered = useGame((s) => s.entered);
  const menuOpen = useGame((s) => s.menuOpen);
  // Title / pause overlay is opaque — keep match chrome out of the way so
  // it cannot peek through or steal layout on phones.
  if (!entered || menuOpen) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      <BackButton />
      <TeamFpv />
      <Scoreboard />
      <GitHubLink
        sx={{
          position: "fixed",
          top: { xs: "0.55rem", sm: "1.2rem" },
          right: { xs: "0.5rem", sm: "1.5rem" },
          zIndex: 12,
          pointerEvents: "auto",
          width: { xs: "36px", sm: "48px" },
          height: { xs: "36px", sm: "48px" },
          "& svg": { width: { xs: "20px", sm: "28px" }, height: { xs: "20px", sm: "28px" } },
        }}
      />
      <MatchResultBanner />
      <CommentaryDanmaku />
      <EventTicker />
      <PenaltyIndicator />
      <StrategyBoard />
    </Box>
  );
}
