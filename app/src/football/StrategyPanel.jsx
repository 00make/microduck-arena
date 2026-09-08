// Coach tactics panel: formation + style presets + 0..1 energy-bar knobs + NL hints.
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useGame, gameApi } from "../store.js";
import { MONO, ORANGE } from "../theme.js";
import { ANTON, CREAM, COMIC_INK } from "../ui/comic.jsx";
import {
  DEFAULT_STRATEGY,
  FORMATION_IDS,
  STYLE_IDS,
  KNOB_IDS,
  PRIMARY_KNOB_IDS,
  normalizeStrategy,
  mergeStrategy,
  strategyFromStylePreset,
  parseStrategyHints,
  knobsDiff,
  knobImpact,
  knobPoles,
  strategyFingerprint,
} from "../game/football/strategy.js";
import {
  t,
  formationLabel,
  styleLabel,
  teamLabel,
} from "./i18n.js";

const RED_ACCENT = "#ff4466";
const BLUE_ACCENT = "#4488ff";

function patchStrategy(partial, opts) {
  if (typeof gameApi.setTeamStrategy === "function") {
    return gameApi.setTeamStrategy(partial, opts);
  }
  const team = opts?.team || useGame.getState().userTeam || "red";
  const userTeam = useGame.getState().userTeam || "red";
  const prev = normalizeStrategy(
    team === userTeam
      ? (useGame.getState().userStrategy || DEFAULT_STRATEGY)
      : (useGame.getState().opponentStrategy || DEFAULT_STRATEGY),
  );
  const next = mergeStrategy(prev, partial);
  if (team === userTeam) useGame.setState({ userStrategy: next });
  else useGame.setState({ opponentStrategy: next });
  return next;
}

function patchTeam(team) {
  if (typeof gameApi.setUserTeam === "function") return gameApi.setUserTeam(team);
  useGame.setState({ userTeam: team });
  return team;
}

function LocoPicker({ compact }) {
  const locale = useGame((s) => s.locale) || "en";
  const userTeam = useGame((s) => s.userTeam) || "red";
  const locoByTeam = useGame((s) => s.locoByTeam) || { red: "legs", blue: "legs" };
  const rollersLoading = useGame((s) => s.rollersLoading);
  const locoSwitching = useGame((s) => s.locoSwitching);
  const busy = rollersLoading || locoSwitching;
  const rival = userTeam === "red" ? "blue" : "red";
  const myLoco = locoByTeam[userTeam] === "rollers" ? "rollers" : "legs";
  const rivalLoco = locoByTeam[rival] === "rollers" ? "rollers" : "legs";
  const labels = {
    legs: t(locale, "locoLegs"),
    rollers: busy ? t(locale, "locoLoading") : t(locale, "locoRollers"),
  };
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "0.45rem",
        pb: compact ? "0.45rem" : "0.55rem",
        mb: compact ? "0.15rem" : "0.25rem",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <ChipGroup
        label={`${t(locale, "locoMode")} · ${teamLabel(locale, userTeam)}`}
        options={["legs", "rollers"]}
        labels={labels}
        value={myLoco}
        onChange={(name) => gameApi.setTeamLoco?.(userTeam, name)}
        disabled={busy}
      />
      <ChipGroup
        label={`${t(locale, "locoRival")} · ${teamLabel(locale, rival)}`}
        options={["legs", "rollers"]}
        labels={labels}
        value={rivalLoco}
        onChange={(name) => gameApi.setTeamLoco?.(rival, name)}
        disabled={busy}
      />
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: compact ? "0.48rem" : "0.52rem",
          color: "rgba(255,255,255,0.4)",
          letterSpacing: "0.04em",
          lineHeight: 1.35,
        }}
      >
        {t(locale, "locoSplitHint")}
      </Typography>
    </Box>
  );
}

function ChipGroup({ label, options, labels, value, onChange, disabled }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "0.3rem", alignItems: "stretch" }}>
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
                fontSize: { xs: "0.68rem", sm: "0.72rem" },
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                lineHeight: 1,
                px: { xs: "0.55rem", sm: "0.65rem" },
                py: { xs: "0.5rem", sm: "0.45rem" },
                minHeight: { xs: "2rem", sm: "unset" },
                opacity: disabled ? 0.45 : 1,
                "&:hover": disabled ? undefined : { borderColor: ORANGE },
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

/** Analog energy bar: drag 0..1. */
function EnergyBar({ label, hint, poles, value, onChange }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const [lo, hi] = poles || ["0", "1"];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: "0.58rem",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          {label}
        </Typography>
        <Typography sx={{ fontFamily: ANTON, fontSize: "0.78rem", color: ORANGE, letterSpacing: "0.04em" }}>
          {pct}
        </Typography>
      </Box>
      {hint ? (
        <Typography sx={{ fontFamily: MONO, fontSize: "0.5rem", color: "rgba(255,255,255,0.36)", lineHeight: 1.3 }}>
          {hint}
        </Typography>
      ) : null}
      <Box
        sx={{
          position: "relative",
          height: 14,
          border: "2px solid rgba(255,255,255,0.22)",
          background: "rgba(0,0,0,0.45)",
          boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: `linear-gradient(90deg, rgba(255,122,47,0.35), ${ORANGE})`,
            pointerEvents: "none",
          }}
        />
        <Box
          component="input"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            margin: 0,
            appearance: "none",
            background: "transparent",
            cursor: "pointer",
            "&::-webkit-slider-thumb": {
              appearance: "none",
              width: 14,
              height: 18,
              background: CREAM,
              border: `2px solid ${COMIC_INK}`,
              boxShadow: `2px 2px 0 ${COMIC_INK}`,
            },
            "&::-moz-range-thumb": {
              width: 14,
              height: 18,
              background: CREAM,
              border: `2px solid ${COMIC_INK}`,
              borderRadius: 0,
            },
            "&::-webkit-slider-runnable-track": { background: "transparent" },
            "&::-moz-range-track": { background: "transparent" },
          }}
        />
      </Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: MONO,
          fontSize: "0.48rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
        }}
      >
        <span>{lo}</span>
        <span>{hi}</span>
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
  const opponentStrategy = useGame((s) => s.opponentStrategy) || DEFAULT_STRATEGY;
  const locale = useGame((s) => s.locale) || "en";

  const [editTarget, setEditTarget] = useState("user");
  const [fineOpen, setFineOpen] = useState(false);
  const [hintText, setHintText] = useState("");
  const [hintPreview, setHintPreview] = useState(null);

  const editTeam = editTarget === "user" ? userTeam : (userTeam === "red" ? "blue" : "red");
  const rawStrat = editTarget === "user" ? userStrategy : opponentStrategy;
  const strat = normalizeStrategy(rawStrat);

  const formationLabels = Object.fromEntries(
    FORMATION_IDS.map((id) => [id, formationLabel(locale, id)]),
  );
  const styleLabels = {
    ...Object.fromEntries(STYLE_IDS.map((id) => [id, styleLabel(locale, id)])),
    custom: t(locale, "custom"),
  };
  const styleValue = STYLE_IDS.includes(strat.style) ? strat.style : "custom";
  const applyOpts = { team: editTeam };

  const onStyle = (style) => {
    if (style === "custom") return;
    const next = strategyFromStylePreset(style, strat.formation);
    patchStrategy({ style: next.style, knobs: next.knobs }, applyOpts);
  };

  const onKnob = (id, value) => {
    patchStrategy({
      style: "custom",
      knobs: { ...strat.knobs, [id]: value },
    }, applyOpts);
  };

  const onHintChange = (value) => {
    setHintText(value);
    const { knobs } = parseStrategyHints(value);
    const diff = knobsDiff(strat.knobs, knobs);
    setHintPreview(diff.length ? { knobs, diff } : (value.trim() ? { knobs: {}, diff: [] } : null));
  };

  const onHintApply = () => {
    const { knobs } = parseStrategyHints(hintText);
    const diff = knobsDiff(strat.knobs, knobs);
    if (!diff.length) return;
    patchStrategy({ style: "custom", knobs: { ...strat.knobs, ...knobs } }, applyOpts);
    setHintPreview(null);
    setHintText("");
  };

  const fp = useMemo(() => strategyFingerprint(strat), [strat]);
  const secondaryIds = KNOB_IDS.filter((id) => !PRIMARY_KNOB_IDS.includes(id));

  return (
    <Box
      role="group"
      aria-label={t(locale, "teamTactics")}
      sx={{
        width: "100%",
        maxWidth: compact ? "24rem" : { xs: "100%", sm: "32rem" },
        mx: "auto",
        mt: compact ? 0 : { xs: "0.75rem", sm: "1.35rem" },
        p: compact
          ? "0.75rem 0.85rem"
          : { xs: "0.7rem 0.75rem", sm: "0.95rem 1.05rem" },
        border: `2px solid rgba(255,255,255,0.14)`,
        boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
        background: "rgba(16,16,24,0.72)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? "0.55rem" : { xs: "0.55rem", sm: "0.75rem" },
        textAlign: "left",
        maxHeight: compact
          ? "70vh"
          : { xs: "min(48vh, 26rem)", sm: "none" },
        overflowY: compact ? "auto" : { xs: "auto", sm: "visible" },
        WebkitOverflowScrolling: "touch",
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
        onChange={patchTeam}
        disabled={formationLocked}
      />

      <LocoPicker compact={compact} />

      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: "0.58rem",
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
        }}
      >
        {t(locale, "tacticsSection")}
      </Typography>

      <ChipGroup
        label={t(locale, "editingSide")}
        options={["user", "rival"]}
        labels={{
          user: teamLabel(locale, userTeam),
          rival: `${t(locale, "rivalTactics")} (${teamLabel(locale, userTeam === "red" ? "blue" : "red")})`,
        }}
        value={editTarget}
        onChange={setEditTarget}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : { xs: "1fr", sm: "1fr 1fr" },
          gap: compact ? "0.55rem" : "0.75rem 1rem",
        }}
      >
        <ChipGroup
          label={t(locale, "formation")}
          options={FORMATION_IDS}
          labels={formationLabels}
          value={strat.formation}
          disabled={formationLocked && editTarget === "user"}
          onChange={(formation) => patchStrategy({ formation }, applyOpts)}
        />
        <ChipGroup
          label={t(locale, "style")}
          options={[...STYLE_IDS, ...(styleValue === "custom" ? ["custom"] : [])]}
          labels={styleLabels}
          value={styleValue}
          onChange={onStyle}
        />
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {PRIMARY_KNOB_IDS.map((id) => (
          <EnergyBar
            key={id}
            label={t(locale, `knob_${id}`)}
            hint={knobImpact(locale, id)}
            poles={knobPoles(locale, id)}
            value={strat.knobs[id]}
            onChange={(v) => onKnob(id, v)}
          />
        ))}
      </Box>

      <Box sx={{ display: "flex", gap: "0.4rem", alignItems: "stretch" }}>
        <Box
          component="input"
          value={hintText}
          onChange={(e) => onHintChange(e.target.value)}
          placeholder={t(locale, "hintPlaceholder")}
          sx={{
            flex: 1,
            minWidth: 0,
            appearance: "none",
            border: "2px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.35)",
            color: CREAM,
            fontFamily: MONO,
            fontSize: "0.62rem",
            px: "0.55rem",
            py: "0.45rem",
            outline: "none",
            "&:focus": { borderColor: ORANGE },
          }}
        />
        <Box
          component="button"
          type="button"
          onClick={onHintApply}
          disabled={!hintPreview?.diff?.length}
          sx={{
            appearance: "none",
            cursor: hintPreview?.diff?.length ? "pointer" : "default",
            border: `2px solid ${ORANGE}`,
            background: hintPreview?.diff?.length ? "rgba(255,122,47,0.25)" : "rgba(0,0,0,0.25)",
            color: CREAM,
            fontFamily: ANTON,
            fontSize: "0.68rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            px: "0.7rem",
            opacity: hintPreview?.diff?.length ? 1 : 0.4,
          }}
        >
          {t(locale, "hintApply")}
        </Box>
      </Box>
      {hintPreview ? (
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: "0.52rem",
            color: hintPreview.diff.length ? "rgba(255,200,120,0.9)" : "rgba(255,255,255,0.4)",
            lineHeight: 1.4,
          }}
        >
          {hintPreview.diff.length
            ? `${t(locale, "hintPreview")}: ${hintPreview.diff.map((d) => `${d.id} ${Math.round(d.from * 100)}→${Math.round(d.to * 100)}`).join(", ")}`
            : t(locale, "hintEmpty")}
        </Typography>
      ) : null}

      <Box
        component="button"
        type="button"
        onClick={() => setFineOpen((v) => !v)}
        sx={{
          appearance: "none",
          cursor: "pointer",
          border: "none",
          background: "transparent",
          color: ORANGE,
          fontFamily: MONO,
          fontSize: "0.56rem",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textAlign: "left",
          p: 0,
        }}
      >
        {fineOpen ? t(locale, "fineTuneHide") : t(locale, "fineTuneShow")}
      </Box>

      {fineOpen ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {secondaryIds.map((id) => (
            <EnergyBar
              key={id}
              label={t(locale, `knob_${id}`)}
              hint={knobImpact(locale, id)}
              poles={knobPoles(locale, id)}
              value={strat.knobs[id]}
              onChange={(v) => onKnob(id, v)}
            />
          ))}
        </Box>
      ) : null}

      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: "0.56rem",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: editTeam === "red" ? RED_ACCENT : BLUE_ACCENT,
        }}
      >
        {teamLabel(locale, editTeam)} · {formationLabels[strat.formation]} · {styleLabels[styleValue]}
        {" · "}
        {fp}
        {formationLocked && editTarget === "user" ? ` · ${t(locale, "formationLocked")}` : ""}
      </Typography>
    </Box>
  );
}
