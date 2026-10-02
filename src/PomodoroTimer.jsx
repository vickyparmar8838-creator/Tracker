import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";

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

/* ================================================================
   Pet cat — walks along the top of the Focus card, talks in speech
   bubbles, changes mood with your sessions, naps while you focus,
   and celebrates when a session is finished.
================================================================ */

const CAT_LINES = {
  low: [
    "Wanna study together? 📚",
    "I'm bored… start a timer?",
    "Psst… one tiny session?",
    "Mrrp? Let's get started!",
  ],
  ok: [
    "Purr… 💕",
    "Keep going, you're doing great!",
    "Meow! 🐱",
    "Don't forget to drink water 💧",
  ],
  happy: [
    "You're on fire! 🔥",
    "Best study buddy ever 💖",
    "Purrrr… 😻",
    "Treat time? 🐟",
  ],
};
const NAP_LINES = ["Zzz… 😴", "Shh… I'm napping", "Mrrp… keep going 💪"];
const DONE_LINES = ["Session done! Great job 🎉", "You did it! 🌟", "Yay! Proud of you 💖"];

/* little burst of confetti when a session is completed */
const CONFETTI = Array.from({ length: 10 }, (_, i) => ({
  ch: ["🎉", "✨", "💖", "⭐", "🎊"][i % 5],
  dx: `${(i - 4.5) * 16}px`,
  dy: `${-70 - (i % 3) * 28}px`,
  delay: `${(i % 4) * 70}ms`,
}));

let catGreeted = false; // greet once per page load, not every time you revisit the Dashboard

const rand = (min, max) => min + Math.random() * (max - min);

function pickLine(pool, lastRef) {
  let line = pool[Math.floor(Math.random() * pool.length)];
  for (let i = 0; i < 4 && line === lastRef.current && pool.length > 1; i += 1) {
    line = pool[Math.floor(Math.random() * pool.length)];
  }
  lastRef.current = line;
  return line;
}

function meow() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(880, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(480, t + 0.5);
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* audio blocked — ignore */
  }
}

function PetCat({ state, mood, paused, busy, phase, round, rounds, sessionsToday, sound }) {
  const [petted, setPetted] = useState(false);
  const [celebrating, setCelebrating] = useState(0); // 0 = no, otherwise an id that restarts the burst
  const [bubble, setBubble] = useState(null); // { text, id, ms }
  const [pos, setPos] = useState({ left: null, ms: 0 }); // px from the left of the track
  const [facing, setFacing] = useState(1); // 1 = right, -1 = left
  const [walking, setWalking] = useState(false);

  const trackRef = useRef(null);
  const catRef = useRef(null);
  const lastLine = useRef("");
  const bubbleTimer = useRef(0);
  const petTimer = useRef(0);
  const celebrateTimer = useRef(0);
  const disarmTimer = useRef(0);
  const armed = useRef(false); // true while a timer session is in progress (or just ended)
  const celebratedAt = useRef(0);
  const prevState = useRef(state);
  const prevSessions = useRef(sessionsToday);

  const maxLeft = () => {
    const track = trackRef.current;
    const cat = catRef.current;
    return track && cat ? Math.max(0, track.clientWidth - cat.offsetWidth) : 0;
  };
  const curLeft = () => {
    const track = trackRef.current;
    const cat = catRef.current;
    return track && cat ? cat.getBoundingClientRect().left - track.getBoundingClientRect().left : 0;
  };

  const say = useCallback((text, ms = 4200) => {
    clearTimeout(bubbleTimer.current);
    setBubble({ text, id: Date.now(), ms });
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  const lineFor = () => {
    if (state === "focus") return pickLine(NAP_LINES, lastLine);
    const pool = [...CAT_LINES[mood]];
    if (phase === "focus" && round > 0 && round < rounds) {
      const left = rounds - round;
      pool.push(`${left} more ${left === 1 ? "session" : "sessions"} until a long break`);
    }
    if (state === "break") pool.push("Stretch those legs! 🧘");
    return pickLine(pool, lastLine);
  };

  /* start on the right-hand side of the card */
  useLayoutEffect(() => {
    setPos({ left: maxLeft(), ms: 0 });
  }, []);

  /* keep the cat inside the card when the window is resized */
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({ left: Math.min(p.left ?? 0, maxLeft()), ms: 0 }));
      setWalking(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* clear timers on unmount */
  useEffect(
    () => () => {
      clearTimeout(bubbleTimer.current);
      clearTimeout(petTimer.current);
      clearTimeout(celebrateTimer.current);
      clearTimeout(disarmTimer.current);
    },
    []
  );

  /* greet once when the page loads */
  useEffect(() => {
    const id = setTimeout(() => {
      if (catGreeted) return;
      catGreeted = true;
      say(sessionsToday === 0 ? "Hi! Ready to study? 📚" : "Welcome back! 💕");
    }, 1200);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* remember that a session is/was in progress, so a new finished session
     is told apart from sessionsToday simply loading in */
  useEffect(() => {
    clearTimeout(disarmTimer.current);
    if (busy) {
      armed.current = true;
    } else {
      disarmTimer.current = setTimeout(() => {
        armed.current = false;
      }, 6000);
    }
  }, [busy]);

  /* a session was finished -> celebrate */
  useEffect(() => {
    const prev = prevSessions.current;
    prevSessions.current = sessionsToday;
    if (sessionsToday > prev && armed.current) {
      armed.current = false;
      celebratedAt.current = Date.now();
      setCelebrating(Date.now());
      say(pickLine(DONE_LINES, lastLine), 4500);
      clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => setCelebrating(0), 2400);
    }
  }, [sessionsToday, say]);

  /* react to the timer starting / pausing */
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (prev === state) return;
    if (Date.now() - celebratedAt.current < 1500) return; // the celebration wins
    if (state === "focus") say("Shh… focus time 🤫");
    else if (state === "break") {
      say(phase === "long" ? "Long break — you earned it 🎉" : "Break time! Stretch & sip some water 💧");
    } else if (paused) say("Paused — I'll wait 🐾");
  }, [state, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* chat a little now and then (never while napping) */
  useEffect(() => {
    if (state === "focus") return undefined;
    const id = setInterval(() => say(lineFor(), 4200), 75000);
    return () => clearInterval(id);
  }, [state, mood, phase, round, rounds, say]); // eslint-disable-line react-hooks/exhaustive-deps

  /* wander along the card edge; stay put while napping or being petted */
  useEffect(() => {
    if (state === "focus" || petted) {
      setPos({ left: curLeft(), ms: 0 }); // freeze where it is
      setWalking(false);
      return undefined;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    let timer;
    const wander = () => {
      const max = maxLeft();
      if (max < 60) return 0;
      const from = curLeft();
      let to = Math.random() * max;
      if (Math.abs(to - from) < 90) {
        to = from < max / 2 ? Math.min(max, from + 140) : Math.max(0, from - 140);
      }
      const ms = Math.abs(to - from) / 0.045; // ~45px per second
      setFacing(to > from ? 1 : -1);
      setWalking(true);
      setPos({ left: to, ms });
      return ms;
    };
    const loop = () => {
      timer = setTimeout(
        () => {
          const ms = wander();
          timer = setTimeout(loop, ms);
        },
        state === "break" ? rand(1500, 3500) : rand(3500, 8000)
      );
    };
    loop();
    return () => clearTimeout(timer);
  }, [state, petted]); // eslint-disable-line react-hooks/exhaustive-deps

  function pet() {
    setPetted(true);
    clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => setPetted(false), 1500);
    if (sound && state !== "focus") meow();
    say(lineFor(), 3800);
  }

  const cls = ["pet-cat", petted && "petted", walking && "walking", celebrating && "celebrating"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="cat-track" ref={trackRef}>
      <div
        ref={catRef}
        className={cls}
        data-state={state}
        data-mood={mood}
        style={pos.left == null ? undefined : { left: pos.left, transitionDuration: `${pos.ms}ms` }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === "left") setWalking(false);
        }}
      >
        {bubble && (
          <div
            className="cat-bubble"
            key={bubble.id}
            aria-hidden="true"
            style={{ animationDuration: `${bubble.ms}ms` }}
          >
            {bubble.text}
          </div>
        )}

        {celebrating > 0 && (
          <div className="cat-confetti" key={celebrating} aria-hidden="true">
            {CONFETTI.map((c, i) => (
              <span key={i} style={{ "--dx": c.dx, "--dy": c.dy, "--delay": c.delay }}>
                {c.ch}
              </span>
            ))}
          </div>
        )}

        <div className="cat-bob" style={{ scale: facing === -1 ? "-1 1" : "1 1" }}>
          <button type="button" className="cat-body" onClick={pet} aria-label="Pet the cat" title="Pet me!">
            <svg viewBox="0 0 120 100" aria-hidden="true">
              <path className="cat-tail" d="M92 88 C 120 88, 118 55, 104 52"
                fill="none" stroke="#f4a259" strokeWidth="9" strokeLinecap="round" />
              <ellipse cx="60" cy="82" rx="34" ry="18" fill="#f4a259" />
              <ellipse cx="44" cy="94" rx="9" ry="5" fill="#fbc98f" />
              <ellipse cx="76" cy="94" rx="9" ry="5" fill="#fbc98f" />
              <g className="cat-head">
                <g className="cat-ear cat-ear-l">
                  <polygon points="34,34 38,10 54,26" fill="#f4a259" />
                  <polygon points="39,30 40,17 49,26" fill="#f2a0a0" />
                </g>
                <g className="cat-ear cat-ear-r">
                  <polygon points="86,34 82,10 66,26" fill="#f4a259" />
                  <polygon points="81,30 80,17 71,26" fill="#f2a0a0" />
                </g>
                <circle cx="60" cy="46" r="28" fill="#f4a259" />
                <g className="cat-eyes">
                  <ellipse cx="49" cy="44" rx="4" ry="5" fill="#1f2937" />
                  <ellipse cx="71" cy="44" rx="4" ry="5" fill="#1f2937" />
                </g>
                {mood === "happy" && (
                  <g fill="#f08a8a" opacity=".55">
                    <ellipse cx="41" cy="54" rx="5" ry="3" />
                    <ellipse cx="79" cy="54" rx="5" ry="3" />
                  </g>
                )}
                <path d="M57 53 L63 53 L60 57 Z" fill="#e76f6f" />
                {mood === "low" && (
                  <path d="M54 64 Q60 58 66 64" fill="none" stroke="#7c4a1e" strokeWidth="1.6" strokeLinecap="round" />
                )}
                {mood === "ok" && (
                  <path d="M60 57 Q57 62 53 60 M60 57 Q63 62 67 60" fill="none" stroke="#7c4a1e" strokeWidth="1.6" strokeLinecap="round" />
                )}
                {mood === "happy" && <path d="M53 59 Q60 71 67 59 Z" fill="#b3414f" stroke="#7c4a1e" strokeWidth="1.2" strokeLinejoin="round" />}
                <g stroke="#7c4a1e" strokeWidth="1.2" strokeLinecap="round">
                  <line x1="38" y1="54" x2="22" y2="52" />
                  <line x1="38" y1="58" x2="22" y2="60" />
                  <line x1="82" y1="54" x2="98" y2="52" />
                  <line x1="82" y1="58" x2="98" y2="60" />
                </g>
              </g>
              <text className="cat-zzz" x="88" y="22" fontSize="14" fill="#8b93a7">Zzz</text>
              <text className="cat-heart" x="56" y="16" fontSize="16" fill="#ef5b7b">♥</text>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PomodoroTimer({ pomodoro: p, subjects = [], sessionsToday = 0 }) {
  const { settings, phase, remaining, running, round, locked } = p;
  const paused = locked && !running;
  const catState = running ? (phase === "focus" ? "focus" : "break") : "idle";
  /* the cat's mood follows how many focus sessions you finished today */
  const catMood = sessionsToday >= 3 ? "happy" : sessionsToday >= 1 ? "ok" : "low";

  return (
    <section className="focus-card pomo" data-phase={phase}>
      <PetCat
        state={catState}
        mood={catMood}
        paused={paused}
        busy={locked}
        phase={phase}
        round={round}
        rounds={settings.rounds}
        sessionsToday={sessionsToday}
        sound={settings.sound}
      />

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
