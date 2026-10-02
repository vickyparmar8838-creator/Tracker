import { useState, useEffect, useRef } from "react";

/* ------------------------------------------------------------------
   Pomodoro timer for StudyTrack

   usePomodoro()    -> all timer state + logic. Call it ONCE in App so the
                       timer keeps running while you visit other pages.
   <PomodoroTimer>  -> the card UI that displays it on the Dashboard.
------------------------------------------------------------------- */

const PRESETS = {
  classic: { label: "Classic", focus: 25, short: 5, long: 15, rounds: 4 },
  deep: { label: "Deep work", focus: 50, short: 10, long: 30, rounds: 3 },
  quick: { label: "Quick", focus: 15, short: 3, long: 10, rounds: 4 },
};

const DEFAULTS = {
  focus: 25,
  short: 5,
  long: 15,
  rounds: 4,
  autoStart: false,
  sound: true,
};

const LIMITS = {
  focus: [1, 180],
  short: [1, 60],
  long: [1, 90],
  rounds: [1, 12],
};

const PHASES = {
  focus: { label: "Focus", hint: "Stay on one thing." },
  short: { label: "Short break", hint: "Stand up, drink some water." },
  long: { label: "Long break", hint: "You earned this one." },
};

export const POMODORO_STORAGE_KEY = "studytrack-pomodoro";

const clamp = (n, [min, max]) => Math.min(max, Math.max(min, n));
const pad = (n) => String(n).padStart(2, "0");
const fmt = (secs) => `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY)) };
  } catch {
    return DEFAULTS;
  }
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.28, 0.56].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.24);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio blocked — ignore */
  }
}

/* ================================================================
   Hook
================================================================ */

export function usePomodoro({ subjects = [], onSessionComplete } = {}) {
  const subjectNames = subjects.map((s) => (typeof s === "string" ? s : s.name));

  const [settings, setSettings] = useState(loadSettings);
  const [phase, setPhase] = useState("focus");
  const [remaining, setRemaining] = useState(() => loadSettings().focus * 60);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0); // focus sessions finished in this cycle
  const [subject, setSubject] = useState(""); // "" = General Study

  const endRef = useRef(0);
  const baseTitle = useRef(document.title);

  const total = settings[phase] * 60;
  const elapsed = total - remaining;
  const locked = running || remaining !== total; // a session is in progress
  const progress = total ? (elapsed / total) * 100 : 0;

  /* drop a subject that was deleted */
  useEffect(() => {
    if (subject && !subjectNames.includes(subject)) setSubject("");
  }, [subjectNames.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  /* persist settings */
  useEffect(() => {
    try {
      localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  /* an untouched timer follows the selected length */
  useEffect(() => {
    if (!running) setRemaining(total);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  /* tick against a deadline so background tabs stay accurate */
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  /* timer reached zero */
  useEffect(() => {
    if (running && remaining === 0) finishPhase();
  }, [remaining, running]); // eslint-disable-line react-hooks/exhaustive-deps

  /* countdown in the browser tab */
  useEffect(() => {
    const base = baseTitle.current;
    document.title = running ? `${fmt(remaining)} · ${PHASES[phase].label} | ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [running, remaining, phase]);

  function goTo(nextPhase, autoStart = false) {
    const secs = settings[nextPhase] * 60;
    setPhase(nextPhase);
    setRemaining(secs);
    if (autoStart) {
      endRef.current = Date.now() + secs * 1000;
      setRunning(true);
    } else {
      setRunning(false);
    }
  }

  function finishPhase() {
    if (settings.sound) beep();

    if (phase === "focus") {
      onSessionComplete?.({ subject, minutes: settings.focus });
      const done = round + 1;
      if (done >= settings.rounds) {
        setRound(0);
        goTo("long", settings.autoStart);
      } else {
        setRound(done);
        goTo("short", settings.autoStart);
      }
    } else {
      goTo("focus", settings.autoStart);
    }
  }

  function start() {
    endRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  }

  function pause() {
    setRemaining(Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000)));
    setRunning(false);
  }

  function reset() {
    setRunning(false);
    setRemaining(total);
  }

  function skip() {
    goTo(phase === "focus" ? "short" : "focus", false);
  }

  /* log the time studied so far and stop (needs at least 1 minute) */
  function finishEarly() {
    if (phase !== "focus" || elapsed < 60) return;
    onSessionComplete?.({
      subject,
      minutes: Math.max(1, Math.round(elapsed / 60)),
      partial: true,
    });
    reset();
  }

  function applyPreset(key) {
    const { label, ...values } = PRESETS[key]; // eslint-disable-line no-unused-vars
    setSettings((s) => ({ ...s, ...values }));
    setRound(0);
  }

  const update = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  function applySettings(next) {
    setSettings({ ...DEFAULTS, ...(next || {}) });
    setRound(0);
    reset();
  }

  function resetAll() {
    setRunning(false);
    setPhase("focus");
    setRound(0);
    setSubject("");
    setSettings(DEFAULTS);
    setRemaining(DEFAULTS.focus * 60);
  }

  const activePreset =
    Object.entries(PRESETS).find(
      ([, p]) =>
        p.focus === settings.focus &&
        p.short === settings.short &&
        p.long === settings.long &&
        p.rounds === settings.rounds
    )?.[0] || "custom";

  return {
    settings, phase, remaining, running, round, subject, setSubject,
    total, elapsed, locked, progress, activePreset,
    goTo, start, pause, reset, skip, finishEarly,
    applyPreset, update, applySettings, resetAll,
  };
}

/* ================================================================
   UI
================================================================ */

/* number input that lets you clear and retype before it commits */
function NumberField({ label, value, range, suffix, disabled, onChange }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  return (
    <label className="pomo-field">
      <span>{label}</span>
      <div className="pomo-field-input">
        <input
          type="number"
          inputMode="numeric"
          min={range[0]}
          max={range[1]}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n) && n >= range[0] && n <= range[1]) onChange(n);
          }}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            const next = Number.isNaN(n) ? value : clamp(n, range);
            setDraft(String(next));
            onChange(next);
          }}
        />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

export default function PomodoroTimer({ pomodoro: p, subjects = [], sessionsToday = 0 }) {
  const { settings, phase, remaining, running, round, locked } = p;
  const paused = locked && !running;

  return (
    <section className="focus-card pomo" data-phase={phase}>
      <header className="focus-header">
        <div>
          <h2>Focus mode</h2>
          <p>{PHASES[phase].hint}</p>
        </div>
        <span className="pomo-today">
          {sessionsToday} {sessionsToday === 1 ? "session" : "sessions"} today
        </span>
      </header>

      <div className="pomo-tabs" role="tablist" aria-label="Timer mode">
        {Object.entries(PHASES).map(([key, ph]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={phase === key}
            className={phase === key ? "pomo-tab active" : "pomo-tab"}
            onClick={() => p.goTo(key, false)}
          >
            {ph.label}
          </button>
        ))}
      </div>

      <div className="pomo-ring" style={{ "--value": p.progress }}>
        <div className="pomo-ring-inner">
          <div className="pomo-time" role="timer" aria-label={`${fmt(remaining)} remaining`}>
            {fmt(remaining)}
          </div>
          <div className="pomo-state">
            {running ? PHASES[phase].label : paused ? "Paused" : "Ready"}
          </div>
        </div>
      </div>

      <div className="pomo-dots" aria-label={`${round} of ${settings.rounds} focus sessions done`}>
        {Array.from({ length: settings.rounds }, (_, i) => (
          <span key={i} className={i < round ? "pomo-dot done" : "pomo-dot"} />
        ))}
        <small>
          {round}/{settings.rounds} until long break
        </small>
      </div>

      {phase === "focus" && (
        <div className="focus-subject">
          <select
            value={p.subject}
            onChange={(e) => p.setSubject(e.target.value)}
            disabled={running}
            aria-label="Subject"
          >
            <option value="">General Study</option>
            {subjects.map((s) => (
              <option key={s.id ?? s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="focus-controls">
        {running ? (
          <button type="button" className="primary-button" onClick={p.pause}>
            ⏸ Pause
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={p.start}>
            ▶ {paused ? "Resume" : "Start"}
          </button>
        )}

        {phase === "focus" && (
          <button
            type="button"
            className="secondary-button"
            onClick={p.finishEarly}
            disabled={p.elapsed < 60}
            title="Log the time studied so far (needs at least 1 minute)"
          >
            ✓ Finish
          </button>
        )}

        <button type="button" className="secondary-button" onClick={p.reset} disabled={!locked}>
          ↻ Reset
        </button>
        <button type="button" className="secondary-button" onClick={p.skip}>
          ⏭ Skip
        </button>
      </div>

      <details className="pomo-settings">
        <summary>Timer settings</summary>

        <div className="pomo-presets" role="group" aria-label="Presets">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              disabled={locked}
              className={p.activePreset === key ? "pomo-chip active" : "pomo-chip"}
              onClick={() => p.applyPreset(key)}
            >
              {preset.label}
              <small>
                {preset.focus}/{preset.short}
              </small>
            </button>
          ))}
          <span className={p.activePreset === "custom" ? "pomo-chip active static" : "pomo-chip static"}>
            Custom
          </span>
        </div>

        <div className="pomo-grid">
          <NumberField label="Focus" suffix="min" range={LIMITS.focus} value={settings.focus} disabled={locked} onChange={p.update("focus")} />
          <NumberField label="Short break" suffix="min" range={LIMITS.short} value={settings.short} disabled={locked} onChange={p.update("short")} />
          <NumberField label="Long break" suffix="min" range={LIMITS.long} value={settings.long} disabled={locked} onChange={p.update("long")} />
          <NumberField label="Sessions per cycle" range={LIMITS.rounds} value={settings.rounds} disabled={locked} onChange={p.update("rounds")} />
        </div>

        <div className="pomo-toggles">
          <label className="pomo-toggle">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(e) => p.update("autoStart")(e.target.checked)}
            />
            <span>Start the next timer automatically</span>
          </label>
          <label className="pomo-toggle">
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => p.update("sound")(e.target.checked)}
            />
            <span>Play a sound when a timer ends</span>
          </label>
        </div>

        {locked && <p className="pomo-note">Reset the timer to change durations.</p>}
      </details>
    </section>
  );
}
