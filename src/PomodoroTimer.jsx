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

/* pet cat preferences + progress live in their own key so they never
   interfere with the timer settings */
export const PET_STORAGE_KEY = "studytrack-pet";
const PET_EVENT = "studytrack-pet-change";
const PET_DEFAULTS = {
  show: true,
  walk: true,
  bubbles: true,
  outfits: true,
  name: "Mochi",
  coat: "orange",
  total: 0, // focus sessions finished together (unlocks outfits)
};

function loadPet() {
  try {
    return { ...PET_DEFAULTS, ...JSON.parse(localStorage.getItem(PET_STORAGE_KEY)) };
  } catch {
    return { ...PET_DEFAULTS };
  }
}

/* patch = object, or (current) => next */
function updatePetStore(patch) {
  const current = loadPet();
  const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
  try {
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(PET_EVENT));
  return next;
}

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
  const [petEvent, setPetEvent] = useState({ type: "", id: 0 }); // lets the cat react to Skip / Reset

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
      updatePetStore((c) => ({ ...c, total: (Number(c.total) || 0) + 1 }));
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
    if (elapsed > 0) setPetEvent({ type: "reset", id: Date.now() });
    setRunning(false);
    setRemaining(total);
  }

  function skip() {
    if (phase === "focus") setPetEvent({ type: "skip", id: Date.now() });
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
    updatePetStore((c) => ({ ...c, total: (Number(c.total) || 0) + 1 }));
    setRunning(false);
    setRemaining(total);
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
    settings, phase, remaining, running, round, subject, setSubject, petEvent,
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
   wakes for the last minute, plays with yarn on breaks, wears
   outfits you unlock, and celebrates when a session is finished.
================================================================ */

/* outfits unlock by total focus sessions finished together */
const OUTFITS = [
  { key: "bow", label: "bow tie", emoji: "🎀", at: 3 },
  { key: "glasses", label: "glasses", emoji: "🕶️", at: 10 },
  { key: "crown", label: "crown", emoji: "👑", at: 25 },
];

const COATS = {
  orange: { label: "Orange", swatch: "#f4a259", body: "#f4a259", light: "#fbc98f", ink: "#7c4a1e", eye: "#1f2937", ear: "#f2a0a0" },
  gray: { label: "Gray", swatch: "#9aa5b1", body: "#9aa5b1", light: "#cfd6dd", ink: "#475569", eye: "#1f2937", ear: "#e7b6c0" },
  black: { label: "Black", swatch: "#374151", body: "#374151", light: "#4b5563", ink: "#cbd5e1", eye: "#fde68a", ear: "#9d6b7b" },
  white: { label: "White", swatch: "#f5f5f4", body: "#f5f5f4", light: "#ffffff", ink: "#94a3b8", eye: "#1f2937", ear: "#f9c4cc", line: "#d6d3d1" },
  calico: {
    label: "Calico",
    swatch: "linear-gradient(135deg, #f8f4ee 42%, #f4a259 42% 70%, #374151 70%)",
    body: "#f8f4ee", light: "#ffffff", ink: "#8b6f5a", eye: "#1f2937", ear: "#f2a0a0",
    earL: "#f4a259", earR: "#374151", tail: "#f4a259", patches: true,
  },
};

const CAT_LINES = {
  low: [
    "Wanna study together? 📚",
    "I'm bored… start a timer?",
    "Psst… one tiny session?",
    "{name} is waiting for you 🐾",
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
    "{name} is so proud of you 💖",
    "Treat time? 🐟",
  ],
};
const NAP_LINES = ["Zzz… 😴", "Shh… I'm napping", "Mrrp… keep going 💪"];
const WAKE_LINES = ["Almost there! ✨", "You've got this! 💪", "Nearly done! 🎯"];
const NIGHT_LINES = ["It's getting late… 🌙", "{name} is sleepy… 😴", "Maybe get some sleep soon? 🛌"];
const DONE_LINES = ["{name} says: nice work! 🎉", "Session done! Great job 🌟", "Yay! {name} is proud of you 💖"];

/* little burst of confetti when a session is completed */
const CONFETTI = Array.from({ length: 10 }, (_, i) => ({
  ch: ["🎉", "✨", "💖", "⭐", "🎊"][i % 5],
  dx: `${(i - 4.5) * 16}px`,
  dy: `${-70 - (i % 3) * 28}px`,
  delay: `${(i % 4) * 70}ms`,
}));

const TAIL_PATH = "M92 88 C 120 88, 118 55, 104 52";
const BALL_SIZE = 26;

let catGreeted = false; // greet once per page load, not every time you revisit the Dashboard

const rand = (min, max) => min + Math.random() * (max - min);
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isNightNow = () => {
  const h = new Date().getHours();
  return h >= 22 || h < 5;
};
/* October gets a witch hat, December a Santa hat */
const seasonalHat = () => {
  const m = new Date().getMonth();
  return m === 9 ? "witch" : m === 11 ? "santa" : null;
};

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

function PetCat({ state, mood, paused, busy, phase, round, rounds, sessionsToday, sound, pet, event }) {
  const { walk, bubbles, outfits, total } = pet;
  const name = (pet.name || "").trim() || PET_DEFAULTS.name;
  const c = COATS[pet.coat] || COATS.orange;

  const [petted, setPetted] = useState(false);
  const [celebrating, setCelebrating] = useState(0); // 0 = no, otherwise an id that restarts the burst
  const [bubble, setBubble] = useState(null); // { text, id, ms }
  const [pos, setPos] = useState({ left: null, ms: 0 }); // px from the left of the track
  const [facing, setFacing] = useState(1); // 1 = right, -1 = left
  const [walking, setWalking] = useState(false);
  const [act, setAct] = useState(""); // "" | "stretch" | "groom" | "yawn"
  const [grumpy, setGrumpy] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [ball, setBall] = useState(null); // { x, rot } while the yarn ball is out
  const [night, setNight] = useState(isNightNow);

  const trackRef = useRef(null);
  const catRef = useRef(null);
  const lastLine = useRef("");
  const bubbleTimer = useRef(0);
  const petTimer = useRef(0);
  const celebrateTimer = useRef(0);
  const disarmTimer = useRef(0);
  const grumpyTimer = useRef(0);
  const flipTimer = useRef(0);
  const armed = useRef(false); // true while a timer session is in progress (or just ended)
  const celebratedAt = useRef(0);
  const prevState = useRef(state);
  const prevSessions = useRef(sessionsToday);
  const prevTotal = useRef(total);
  const eventSeen = useRef(0);
  const clickCount = useRef(0);
  const lastClick = useRef(0);
  const ballRef = useRef(null);
  const rotRef = useRef(0);

  /* always-fresh values for timers/effects that must not restart on every change */
  const bubblesRef = useRef(bubbles);
  const nameRef = useRef(name);
  const nightRef = useRef(night);
  const statusRef = useRef({});
  bubblesRef.current = bubbles;
  nameRef.current = name;
  nightRef.current = night;
  statusRef.current = { walking, petted, celebrating: !!celebrating, act, grumpy, flipping };

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
    if (!bubblesRef.current) return;
    clearTimeout(bubbleTimer.current);
    setBubble({ text: text.replaceAll("{name}", nameRef.current), id: Date.now(), ms });
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  const lineFor = () => {
    if (state === "focus") return pickLine(NAP_LINES, lastLine);
    if (state === "wake") return pickLine(WAKE_LINES, lastLine);
    const pool = [...CAT_LINES[mood]];
    if (night) pool.push(...NIGHT_LINES);
    if (phase === "focus" && round > 0 && round < rounds) {
      const left = rounds - round;
      pool.push(`${left} more ${left === 1 ? "session" : "sessions"} until a long break`);
    }
    if (state === "break") pool.push("Stretch those legs! 🧘");
    return pickLine(pool, lastLine);
  };

  const makeGrumpy = (ms) => {
    setGrumpy(true);
    clearTimeout(grumpyTimer.current);
    grumpyTimer.current = setTimeout(() => setGrumpy(false), ms);
  };

  /* roll the yarn ball somewhere else (the cat will chase it) */
  const kickBall = () => {
    const track = trackRef.current;
    const from = ballRef.current;
    if (!track || from == null) return;
    const maxB = Math.max(0, track.clientWidth - BALL_SIZE);
    let to = rand(0, maxB);
    if (Math.abs(to - from) < 120) to = from < maxB / 2 ? Math.min(maxB, from + 160) : Math.max(0, from - 160);
    ballRef.current = to;
    rotRef.current += (to - from) * 2;
    setBall({ x: to, rot: rotRef.current });
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

  /* night mode: after 10pm the cat wears a sleep cap and moves slowly */
  useEffect(() => {
    const id = setInterval(() => setNight(isNightNow()), 60000);
    return () => clearInterval(id);
  }, []);

  /* clear timers on unmount */
  useEffect(
    () => () => {
      clearTimeout(bubbleTimer.current);
      clearTimeout(petTimer.current);
      clearTimeout(celebrateTimer.current);
      clearTimeout(disarmTimer.current);
      clearTimeout(grumpyTimer.current);
      clearTimeout(flipTimer.current);
    },
    []
  );

  /* hide any open bubble when bubbles get switched off */
  useEffect(() => {
    if (!bubbles) {
      clearTimeout(bubbleTimer.current);
      setBubble(null);
    }
  }, [bubbles]);

  /* greet once when the page loads */
  useEffect(() => {
    const id = setTimeout(() => {
      if (catGreeted) return;
      catGreeted = true;
      say(sessionsToday === 0 ? "Hi! I'm {name}. Ready to study? 📚" : "Welcome back! 💕");
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

  /* a new outfit was unlocked */
  useEffect(() => {
    const prev = prevTotal.current;
    prevTotal.current = total;
    if (total <= prev || !outfits) return undefined;
    const unlocked = OUTFITS.find((o) => prev < o.at && total >= o.at);
    if (!unlocked) return undefined;
    const id = setTimeout(() => say(`New outfit unlocked: ${unlocked.label} ${unlocked.emoji}`, 5000), 2800);
    return () => clearTimeout(id);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  /* react to Skip / Reset */
  useEffect(() => {
    if (!event || !event.id || event.id === eventSeen.current) return;
    eventSeen.current = event.id;
    if (Date.now() - event.id > 2000) return; // an old event from before this page was opened
    if (event.type === "skip") {
      makeGrumpy(2500);
      say("Hmph. Skipping already? 😒", 3500);
    } else if (event.type === "reset") {
      say("Starting over? Okay… 🐾", 3500);
    }
  }, [event]); // eslint-disable-line react-hooks/exhaustive-deps

  /* react to the timer starting / pausing / entering the last minute */
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (prev === state) return;
    if (Date.now() - celebratedAt.current < 1500) return; // the celebration wins
    if (state === "focus") say("Shh… focus time 🤫");
    else if (state === "wake") say("Almost there! One last minute ✨", 3500);
    else if (state === "break") {
      say(phase === "long" ? "Long break — you earned it 🎉" : "Break time! Stretch & sip some water 💧");
    } else if (paused) say("Paused — I'll wait 🐾");
  }, [state, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* chat a little now and then (never while napping) */
  useEffect(() => {
    if (state === "focus" || state === "wake") return undefined;
    const id = setInterval(() => say(lineFor(), 4200), 75000);
    return () => clearInterval(id);
  }, [state, mood, phase, round, rounds, night, say]); // eslint-disable-line react-hooks/exhaustive-deps

  /* idle behaviours: stretch, groom, yawn */
  useEffect(() => {
    if (state !== "idle" || reducedMotion()) return undefined;
    let t1;
    let t2;
    const loop = () => {
      t1 = setTimeout(
        () => {
          const s = statusRef.current;
          if (!s.walking && !s.petted && !s.celebrating && !s.act && !s.grumpy && !s.flipping) {
            const pool = nightRef.current ? ["yawn", "yawn", "stretch", "groom"] : ["stretch", "groom", "yawn"];
            setAct(pool[Math.floor(Math.random() * pool.length)]);
            t2 = setTimeout(() => setAct(""), 2600);
          }
          loop();
        },
        nightRef.current ? rand(8000, 16000) : rand(12000, 26000)
      );
    };
    loop();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      setAct("");
    };
  }, [state]);

  /* the yarn ball comes out during breaks */
  useEffect(() => {
    const track = trackRef.current;
    if (state === "break" && walk && track) {
      const maxB = Math.max(0, track.clientWidth - BALL_SIZE);
      const x = curLeft() < maxLeft() / 2 ? maxB - rand(0, 80) : rand(0, 80);
      ballRef.current = Math.min(maxB, Math.max(0, x));
      rotRef.current = 0;
      setBall({ x: ballRef.current, rot: 0 });
    } else {
      ballRef.current = null;
      setBall(null);
    }
  }, [state, walk]);

  /* wander along the card edge; stay put while napping or being petted;
     chase the yarn ball on breaks */
  useEffect(() => {
    if (!walk || state === "focus" || state === "wake" || petted) {
      setPos((p) => (p.left == null ? p : { left: curLeft(), ms: 0 })); // freeze where it is
      setWalking(false);
      return undefined;
    }
    if (reducedMotion()) return undefined;

    let timer;
    const speed = () => (nightRef.current ? 0.028 : 0.045); // px per ms

    const moveTo = (to) => {
      const from = curLeft();
      const ms = Math.abs(to - from) / speed();
      if (ms < 60) return 0;
      setFacing(to > from ? 1 : -1);
      setWalking(true);
      setPos({ left: to, ms });
      return ms;
    };
    const wander = () => {
      const max = maxLeft();
      if (max < 60) return 0;
      const from = curLeft();
      let to = Math.random() * max;
      if (Math.abs(to - from) < 90) {
        to = from < max / 2 ? Math.min(max, from + 140) : Math.max(0, from - 140);
      }
      return moveTo(to);
    };
    const chase = () => {
      const bx = ballRef.current;
      if (bx == null) return wander();
      const from = curLeft();
      const to = bx > from + 50 ? bx - 60 : bx - 4; // stop with a paw next to the ball
      return moveTo(Math.min(maxLeft(), Math.max(0, to)));
    };
    const loop = () => {
      timer = setTimeout(
        () => {
          const s = statusRef.current;
          if (s.act || s.grumpy || s.flipping || s.celebrating) {
            loop();
            return;
          }
          if (state === "break") {
            const ms = chase();
            timer = setTimeout(() => {
              kickBall();
              loop();
            }, ms + 300);
          } else {
            const ms = wander();
            timer = setTimeout(loop, ms);
          }
        },
        state === "break" ? rand(500, 1200) : rand(3500, 8000)
      );
    };
    loop();
    return () => clearTimeout(timer);
  }, [state, petted, walk]); // eslint-disable-line react-hooks/exhaustive-deps

  function pet_() {
    const now = Date.now();
    clickCount.current = now - lastClick.current > 1500 ? 1 : clickCount.current + 1;
    lastClick.current = now;
    const n = clickCount.current;
    const still = state === "focus" || state === "wake";

    /* easter eggs: poke it too much and it gets grumpy, keep going and it does a backflip */
    if (!still) {
      if (n >= 12) {
        clickCount.current = 0;
        setGrumpy(false);
        clearTimeout(grumpyTimer.current);
        setFlipping(true);
        clearTimeout(flipTimer.current);
        flipTimer.current = setTimeout(() => setFlipping(false), 1000);
        say("Ta-da! 🤸", 3000);
        return;
      }
      if (grumpy) {
        say("Hmph! 😾", 2500);
        return;
      }
      if (n === 7) {
        makeGrumpy(3500);
        say("Okay okay, that's enough! 😾", 3500);
        return;
      }
    }

    setPetted(true);
    clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => setPetted(false), 1500);
    if (sound && state !== "focus") meow();
    say(lineFor(), 3800);
  }

  /* what the cat is wearing */
  const headItem = !outfits ? null : night ? "nightcap" : seasonalHat() || (total >= 25 ? "crown" : null);
  const wearBow = outfits && total >= 3;
  const wearGlasses = outfits && total >= 10;

  const cls = [
    "pet-cat",
    petted && "petted",
    walking && "walking",
    celebrating && "celebrating",
    grumpy && "grumpy",
    flipping && "flipping",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="cat-track" ref={trackRef}>
      {ball && (
        <button
          type="button"
          className="cat-yarn"
          style={{ left: ball.x, rotate: `${ball.rot}deg` }}
          onClick={kickBall}
          aria-label="Roll the yarn ball"
          title="Roll it!"
        >
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="12" fill="#f26d8d" />
            <path d="M4 12 Q14 6 24 12 M3 17 Q14 11 25 17 M8 5 Q17 14 10 24" fill="none" stroke="#ffd1dc" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M22 21 Q27 24 25 27" fill="none" stroke="#f26d8d" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <div
        ref={catRef}
        className={cls}
        data-state={state}
        data-mood={mood}
        data-act={act || undefined}
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
            {CONFETTI.map((piece, i) => (
              <span key={i} style={{ "--dx": piece.dx, "--dy": piece.dy, "--delay": piece.delay }}>
                {piece.ch}
              </span>
            ))}
          </div>
        )}

        <div className="cat-bob" style={{ scale: facing === -1 ? "-1 1" : "1 1" }}>
          <button
            type="button"
            className="cat-body"
            onClick={pet_}
            aria-label={`Pet ${name}`}
            title={`Pet ${name}!`}
          >
            <svg viewBox="0 -16 120 116" aria-hidden="true">
              <defs>
                <clipPath id="cat-clip-head"><circle cx="60" cy="46" r="28" /></clipPath>
                <clipPath id="cat-clip-body"><ellipse cx="60" cy="82" rx="34" ry="18" /></clipPath>
              </defs>

              <g className="cat-tail">
                {c.line && <path d={TAIL_PATH} fill="none" stroke={c.line} strokeWidth="11.5" strokeLinecap="round" />}
                <path d={TAIL_PATH} fill="none" stroke={c.tail || c.body} strokeWidth="9" strokeLinecap="round" />
              </g>

              <ellipse cx="60" cy="82" rx="34" ry="18" fill={c.body} stroke={c.line || "none"} strokeWidth="1.2" />
              {c.patches && <ellipse cx="84" cy="78" rx="13" ry="9" fill="#374151" clipPath="url(#cat-clip-body)" />}
              <ellipse cx="44" cy="94" rx="9" ry="5" fill={c.light} />
              <ellipse cx="76" cy="94" rx="9" ry="5" fill={c.light} />

              {wearBow && (
                <g>
                  <polygon points="60,74 47,67 47,81" fill="#ef4444" />
                  <polygon points="60,74 73,67 73,81" fill="#ef4444" />
                  <circle cx="60" cy="74" r="3.6" fill="#b91c1c" />
                </g>
              )}

              <g className="cat-head">
                <g className="cat-ear cat-ear-l">
                  <polygon points="34,34 38,10 54,26" fill={c.earL || c.body} stroke={c.line || "none"} strokeWidth="1" />
                  <polygon points="39,30 40,17 49,26" fill={c.ear} />
                </g>
                <g className="cat-ear cat-ear-r">
                  <polygon points="86,34 82,10 66,26" fill={c.earR || c.body} stroke={c.line || "none"} strokeWidth="1" />
                  <polygon points="81,30 80,17 71,26" fill={c.ear} />
                </g>
                <circle cx="60" cy="46" r="28" fill={c.body} stroke={c.line || "none"} strokeWidth="1.2" />
                {c.patches && (
                  <g clipPath="url(#cat-clip-head)">
                    <ellipse cx="42" cy="32" rx="13" ry="10" fill="#f4a259" />
                    <ellipse cx="82" cy="58" rx="12" ry="10" fill="#374151" />
                  </g>
                )}

                <g className="cat-eyes">
                  <ellipse cx="49" cy="44" rx="4" ry="5" fill={c.eye} />
                  <ellipse cx="71" cy="44" rx="4" ry="5" fill={c.eye} />
                </g>
                {wearGlasses && (
                  <g fill="rgba(255,255,255,.18)" stroke="#1f2937" strokeWidth="2">
                    <circle cx="49" cy="44" r="8.5" />
                    <circle cx="71" cy="44" r="8.5" />
                    <line x1="57.5" y1="44" x2="62.5" y2="44" />
                  </g>
                )}
                {mood === "happy" && (
                  <g fill="#f08a8a" opacity=".55">
                    <ellipse cx="41" cy="54" rx="5" ry="3" />
                    <ellipse cx="79" cy="54" rx="5" ry="3" />
                  </g>
                )}
                <path d="M57 53 L63 53 L60 57 Z" fill="#e76f6f" />

                {grumpy || mood === "low" ? (
                  <path d="M54 64 Q60 58 66 64" fill="none" stroke={c.ink} strokeWidth="1.6" strokeLinecap="round" />
                ) : mood === "ok" ? (
                  <path d="M60 57 Q57 62 53 60 M60 57 Q63 62 67 60" fill="none" stroke={c.ink} strokeWidth="1.6" strokeLinecap="round" />
                ) : (
                  <path d="M53 59 Q60 71 67 59 Z" fill="#b3414f" stroke={c.ink} strokeWidth="1.2" strokeLinejoin="round" />
                )}
                <ellipse className="cat-yawn" cx="60" cy="63" rx="5" ry="6" fill="#b3414f" />
                <ellipse className="cat-paw" cx="46" cy="64" rx="6" ry="8" fill={c.light} stroke={c.ink} strokeWidth="1" />

                <g className="cat-brows" stroke={c.ink} strokeWidth="2.2" strokeLinecap="round">
                  <line x1="41" y1="35" x2="54" y2="39" />
                  <line x1="79" y1="35" x2="66" y2="39" />
                </g>
                <g stroke={c.ink} strokeWidth="1.2" strokeLinecap="round">
                  <line x1="38" y1="54" x2="22" y2="52" />
                  <line x1="38" y1="58" x2="22" y2="60" />
                  <line x1="82" y1="54" x2="98" y2="52" />
                  <line x1="82" y1="58" x2="98" y2="60" />
                </g>

                {headItem === "witch" && (
                  <g transform="rotate(-8 60 22)">
                    <polygon points="45,22 61,-14 75,22" fill="#5b21b6" />
                    <polygon points="46.3,19 73.8,19 71.9,14 48.6,14" fill="#f59e0b" />
                    <ellipse cx="60" cy="22" rx="22" ry="5" fill="#4c1d95" />
                  </g>
                )}
                {headItem === "santa" && (
                  <g transform="rotate(-6 60 22)">
                    <path d="M45 20 Q47 -6 72 -4 Q64 6 76 20 Z" fill="#dc2626" />
                    <rect x="42" y="16" width="38" height="8" rx="4" fill="#ffffff" />
                    <circle cx="72" cy="-4" r="5" fill="#ffffff" />
                  </g>
                )}
                {headItem === "crown" && (
                  <g>
                    <path d="M44 24 L46 8 L53 16 L60 4 L67 16 L74 8 L76 24 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1.2" strokeLinejoin="round" />
                    <circle cx="60" cy="14" r="2" fill="#ef4444" />
                    <circle cx="50" cy="19" r="1.5" fill="#3b82f6" />
                    <circle cx="70" cy="19" r="1.5" fill="#22c55e" />
                  </g>
                )}
                {headItem === "nightcap" && (
                  <g>
                    <path d="M42 24 Q50 -4 74 8 Q90 16 88 34 Q74 18 42 24 Z" fill="#6366f1" />
                    <rect x="40" y="20" width="30" height="7" rx="3.5" fill="#e0e7ff" transform="rotate(-8 55 23)" />
                    <circle cx="88" cy="34" r="5" fill="#ffffff" />
                  </g>
                )}
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

  /* pet cat: saved preferences + progress */
  const [pet, setPet] = useState(loadPet);
  useEffect(() => {
    const sync = () => setPet(loadPet());
    window.addEventListener(PET_EVENT, sync);
    return () => window.removeEventListener(PET_EVENT, sync);
  }, []);
  const changePet = (patch) => setPet(updatePetStore(patch));
  const petName = (pet.name || "").trim() || PET_DEFAULTS.name;
  const nextOutfit = OUTFITS.find((o) => pet.total < o.at);
  const petProgress =
    `${petName} has studied with you for ${pet.total} ${pet.total === 1 ? "session" : "sessions"}` +
    (nextOutfit
      ? ` · next outfit: ${nextOutfit.emoji} ${nextOutfit.label} at ${nextOutfit.at}`
      : " · all outfits unlocked 🎉");

  /* the cat naps while you focus, but wakes for the last minute */
  const nearEnd = running && phase === "focus" && remaining > 0 && remaining <= 60 && p.total > 120;
  const catState = running ? (phase === "focus" ? (nearEnd ? "wake" : "focus") : "break") : "idle";
  /* the cat's mood follows how many focus sessions you finished today */
  const catMood = sessionsToday >= 3 ? "happy" : sessionsToday >= 1 ? "ok" : "low";

  return (
    <section className="focus-card pomo" data-phase={phase}>
      {pet.show && (
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
          pet={pet}
          event={p.petEvent}
        />
      )}

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

        <div className="pomo-pet">
          <h3>Pet cat</h3>

          <div className="pomo-toggles">
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.show} onChange={(e) => changePet({ show: e.target.checked })} />
              <span>Show the cat</span>
            </label>
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.walk} onChange={(e) => changePet({ walk: e.target.checked })} />
              <span>Let it walk around (and play with yarn on breaks)</span>
            </label>
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.bubbles} onChange={(e) => changePet({ bubbles: e.target.checked })} />
              <span>Speech bubbles</span>
            </label>
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.outfits} onChange={(e) => changePet({ outfits: e.target.checked })} />
              <span>Hats &amp; accessories</span>
            </label>
          </div>

          <div className="pomo-pet-row">
            <label className="pomo-field">
              <span>Name</span>
              <div className="pomo-field-input">
                <input
                  type="text"
                  maxLength={14}
                  value={pet.name}
                  placeholder={PET_DEFAULTS.name}
                  onChange={(e) => changePet({ name: e.target.value })}
                />
              </div>
            </label>

            <div className="pomo-field">
              <span>Coat</span>
              <div className="pomo-coats" role="group" aria-label="Coat colour">
                {Object.entries(COATS).map(([key, coat]) => (
                  <button
                    key={key}
                    type="button"
                    className={pet.coat === key ? "pomo-coat active" : "pomo-coat"}
                    style={{ "--coat": coat.swatch }}
                    aria-label={coat.label}
                    aria-pressed={pet.coat === key}
                    title={coat.label}
                    onClick={() => changePet({ coat: key })}
                  />
                ))}
              </div>
            </div>
          </div>

          <p className="pomo-note">{petProgress}</p>
        </div>
      </details>
    </section>
  );
}
