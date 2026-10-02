import { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import PomodoroTimer, {
  usePomodoro,
  POMODORO_STORAGE_KEY,
} from "./PomodoroTimer";
import "./index.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const DEFAULT_SUBJECTS = [
  { id: 1, name: "Mathematics", present: 17, absent: 7, benchmark: 75 },
  { id: 2, name: "Physics", present: 23, absent: 5, benchmark: 80 },
  { id: 3, name: "C++ Programming", present: 17, absent: 8, benchmark: 50 },
];

const DEFAULT_SETTINGS = {
  studentName: "",
  defaultBenchmark: 75,
  warningThreshold: 75,
  dailyStudyGoal: 180,
  theme: "dark",
};

const COURSES = [
  { semester: 1, code: "1RABS1", name: "Applied Mathematics-I" },
  { semester: 1, code: "1RABS2", name: "Applied Chemistry & Environment Science" },
  { semester: 1, code: "1RMES3", name: "General Mechanical Engineering" },
  { semester: 1, code: "1RTES4", name: "Basic Electronics" },
  { semester: 1, code: "1RMES5", name: "Workshop Practice", noUnits: true },
  { semester: 1, code: "1RAHS6", name: "Technical English" },
  { semester: 1, code: "1RAHS7", name: "Design Thinking" },
  { semester: 2, code: "2RABS1", name: "Applied Mathematics-II" },
  { semester: 2, code: "2RABS2", name: "Applied Physics" },
  { semester: 2, code: "2RCES3", name: "Computer Programming" },
  { semester: 2, code: "2REES4", name: "Basic Electrical Engineering" },
  { semester: 2, code: "2RMES5", name: "Engineering Graphics and Design" },
  { semester: 2, code: "2RAHS6", name: "Humanities" },
];

const PAGE_HEADER =
  /Institute of Engineering\s*&\s*Technology,\s*Devi Ahilya University,\s*Indore,\s*\(M\.P\.\),\s*India\.\s*\(Scheme Effective from July 2024\)\s*\d*/gi;

const STOP_WORDS = [
  "Course Outcome",
  "BOOKS RECOMMENDED",
  "Books Recommended",
  "Text/Reference Books",
  "List of Experiments",
  "List of Practical",
  "CO. No.",
  "CO.No.",
  "Course Learning Objective",
  "Course Objective",
  "Devi Ahilya University, Indore, India",
];

const UNIT_REGEX = /\b(?:UNIT|Unit)\s*[-–—]?\s*(I{1,3}|IV|V)\b/g;

function normalizeText(text) {
  return text.replace(PAGE_HEADER, " ").replace(/\s+/g, " ").trim();
}

function cleanTopic(text) {
  return text
    .replace(/^[•●▪◦*\-–—:,\.\s]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[\s.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitUnitTopics(text) {
  const parts = text
    .split(/;|\s[-–—]\s|(?<!\.[a-z])\.\s+(?=[A-Z])/)
    .map(cleanTopic)
    .filter((t) => t.length > 2);
  return parts.length ? parts : [cleanTopic(text)].filter(Boolean);
}

function cutAtStopWords(text) {
  let end = text.length;
  for (const word of STOP_WORDS) {
    const i = text.indexOf(word);
    if (i !== -1 && i < end) end = i;
  }
  return text.slice(0, end);
}

function parseUnits(blockText, code) {
  const matches = [...blockText.matchAll(UNIT_REGEX)];
  return matches
    .map((m, i) => {
      const start = m.index + m[0].length;
      const end =
        i + 1 < matches.length ? matches[i + 1].index : blockText.length;
      const content = cutAtStopWords(blockText.slice(start, end));
      const unitId = `${code}-u${m[1]}`;
      return {
        id: unitId,
        name: `Unit ${m[1]}`,
        topics: splitUnitTopics(content).map((name, k) => ({
          id: `${unitId}-t${k}`,
          name,
          completed: false,
        })),
      };
    })
    .filter((u) => u.topics.length > 0);
}

function parseWorkshop(text, course) {
  const shops = [];
  const re =
    /Introduction of and practice work on the (Fitting|Carpentry|Welding|Foundry|Machine|Plumbing)/g;
  for (const m of text.matchAll(re)) {
    const name = `${m[1]} shop`;
    if (!shops.includes(name)) shops.push(name);
  }
  if (shops.length === 0) return null;
  const unitId = `${course.code}-uShops`;
  return {
    id: course.code,
    code: course.code,
    name: course.name,
    units: [
      {
        id: unitId,
        name: "Trade Shops",
        topics: shops.map((name, k) => ({
          id: `${unitId}-t${k}`,
          name,
          completed: false,
        })),
      },
    ],
  };
}

function parseWholeSyllabus(rawText) {
  const text = normalizeText(rawText);
  const warnings = [];
  const starts = [...text.matchAll(/\b(?:UNIT|Unit)\s*[-–—]?\s*I\b/g)].map(
    (m) => m.index
  );
  const blocks = starts.map((s, i) =>
    text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length)
  );
  const unitCourses = COURSES.filter((c) => !c.noUnits);
  if (blocks.length !== unitCourses.length) {
    warnings.push(
      `Expected ${unitCourses.length} subjects with units but found ${blocks.length}. Some subjects may be missing or misnamed.`
    );
  }
  const syllabus = { semester1: [], semester2: [] };
  let blockIndex = 0;
  for (const course of COURSES) {
    let subject = null;
    if (course.noUnits) {
      subject = parseWorkshop(text, course);
    } else if (blockIndex < blocks.length) {
      const units = parseUnits(blocks[blockIndex++], course.code);
      if (units.length) {
        subject = {
          id: course.code,
          code: course.code,
          name: course.name,
          units,
        };
      }
    }
    if (subject) {
      syllabus[course.semester === 1 ? "semester1" : "semester2"].push(subject);
    } else {
      warnings.push(`Could not read ${course.name}.`);
    }
  }
  return { syllabus, warnings };
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatStudyTime(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function App() {
  const [page, setPage] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [subjects, setSubjects] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-subjects");
      return saved ? JSON.parse(saved) : DEFAULT_SUBJECTS;
    } catch {
      return DEFAULT_SUBJECTS;
    }
  });

  const [syllabus, setSyllabus] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-full-syllabus");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBenchmark, setNewBenchmark] = useState(75);
  const [selectedSyllabusSubject, setSelectedSyllabusSubject] = useState(null);
  const [expandedUnits, setExpandedUnits] = useState({});
  const [newTopic, setNewTopic] = useState("");
  const [uploadingPdf, setUploadingPdf] = useState(false);

  const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const [timetable, setTimetable] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-timetable");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showTimetableForm, setShowTimetableForm] = useState(false);
  const [editingTimetableId, setEditingTimetableId] = useState(null);
  const [timetableForm, setTimetableForm] = useState({
    day: "Monday",
    subject: "",
    startTime: "09:00",
    endTime: "10:00",
    room: "",
    teacher: "",
  });

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [importingBackup, setImportingBackup] = useState(false);

  // =========================================================
  // PRODUCTIVITY / FOCUS
  // =========================================================

  const [studySessions, setStudySessions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("studytrack-sessions") || "[]");
    } catch {
      return [];
    }
  });

  // Called by the Pomodoro timer whenever a focus session ends
  function logFocusSession({ subject, minutes }) {
    setStudySessions((sessions) => [
      ...sessions,
      {
        id: Date.now(),
        date: getLocalDateKey(),
        subject: subject || "General Study",
        duration: minutes,
        type: "focus",
      },
    ]);
  }

  // Lives in App so the timer keeps running while you change pages
  const pomodoro = usePomodoro({
    subjects,
    onSessionComplete: logFocusSession,
  });

  useEffect(() => {
    localStorage.setItem("studytrack-subjects", JSON.stringify(subjects));
  }, [subjects]);

  useEffect(() => {
    localStorage.setItem("studytrack-full-syllabus", JSON.stringify(syllabus));
  }, [syllabus]);

  useEffect(() => {
    localStorage.setItem("studytrack-timetable", JSON.stringify(timetable));
  }, [timetable]);

  useEffect(() => {
    localStorage.setItem("studytrack-settings", JSON.stringify(settings));
    document.documentElement.dataset.studytrackTheme = settings.theme;
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("studytrack-sessions", JSON.stringify(studySessions));
  }, [studySessions]);

  // =========================================================
  // ATTENDANCE
  // =========================================================

  function addSubject() {
    const name = newName.trim();
    if (!name) return;

    const newSubject = {
      id: Date.now(),
      name,
      present: 0,
      absent: 0,
      benchmark: Number(newBenchmark),
    };

    setSubjects((prev) => [...prev, newSubject]);
    setNewName("");
    setNewBenchmark(Number(settings.defaultBenchmark) || 75);
    setShowAdd(false);
  }

  function markAttendance(id, type) {
    setSubjects((prev) =>
      prev.map((subject) => {
        if (subject.id !== id) return subject;
        return {
          ...subject,
          present: type === "present" ? subject.present + 1 : subject.present,
          absent: type === "absent" ? subject.absent + 1 : subject.absent,
        };
      })
    );
  }

  function updateBenchmark(id, value) {
    setSubjects((prev) =>
      prev.map((subject) =>
        subject.id === id
          ? {
              ...subject,
              benchmark: Math.min(100, Math.max(0, Number(value))),
            }
          : subject
      )
    );
  }

  function deleteSubject(id) {
    const subject = subjects.find((item) => item.id === id);
    setSubjects((prev) => prev.filter((subject) => subject.id !== id));

    if (subject) {
      setStudySessions((prev) =>
        prev.map((session) =>
          session.subject === subject.name
            ? { ...session, subject: "General Study" }
            : session
        )
      );
    }
  }

  function getPercentage(subject) {
    const total = subject.present + subject.absent;
    if (total === 0) return 0;
    return Math.round((subject.present / total) * 100);
  }

  function getClassesNeeded(subject) {
    const percentage = getPercentage(subject);
    if (percentage >= subject.benchmark) return 0;
    if (subject.benchmark >= 100) return Infinity;

    const P = subject.present;
    const T = subject.present + subject.absent;
    const B = subject.benchmark / 100;
    return Math.ceil((B * T - P) / (1 - B));
  }

  function getClassesCanMiss(subject) {
    const percentage = getPercentage(subject);
    if (percentage < subject.benchmark) return 0;
    if (subject.benchmark <= 0) return Infinity;

    const P = subject.present;
    const T = subject.present + subject.absent;
    const B = subject.benchmark / 100;
    return Math.floor(P / B - T);
  }

  function overallAttendance() {
    let present = 0;
    let total = 0;

    subjects.forEach((subject) => {
      present += subject.present;
      total += subject.present + subject.absent;
    });

    if (total === 0) return 0;
    return Math.round((present / total) * 100);
  }

  // =========================================================
  // PDF SYLLABUS IMPORT
  // =========================================================

  async function extractPdfText(file) {
    if (!file) throw new Error("No PDF file selected.");

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error("The selected PDF file is empty.");
    }

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      });

      const pdf = await loadingTask.promise;
      const pages = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const pdfPage = await pdf.getPage(pageNumber);
        const content = await pdfPage.getTextContent();
        const text = content.items.map((item) => item?.str || "").join(" ");
        pages.push(text);
      }

      const fullText = pages.join("\n").trim();

      if (!fullText) {
        throw new Error(
          "PDF opened successfully, but no selectable text was found."
        );
      }

      return fullText;
    } catch (error) {
      console.error("PDFJS ERROR:", error);
      throw new Error(
        error?.message || "The PDF could not be opened by the PDF reader."
      );
    }
  }

  async function handleWholePdfUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Please select a PDF file.");
      return;
    }

    setUploadingPdf(true);

    try {
      const text = await extractPdfText(file);
      const { syllabus: parsed, warnings } = parseWholeSyllabus(text);
      const allSubjects = [...parsed.semester1, ...parsed.semester2];
      const totalSubjects = allSubjects.length;
      const totalUnits = allSubjects.reduce(
        (total, subject) => total + subject.units.length,
        0
      );

      if (totalSubjects === 0) {
        alert(
          "No syllabus subjects were detected. Please make sure this is the IET DAVV syllabus PDF."
        );
        setUploadingPdf(false);
        event.target.value = "";
        return;
      }

      const replace = window.confirm(
        `Detected ${totalSubjects} subjects and ${totalUnits} units.` +
          (warnings.length
            ? `\n\nWarnings:\n- ${warnings.join("\n- ")}`
            : "") +
          `\n\nPress OK to import the syllabus.\nYour current imported syllabus will be replaced.`
      );

      if (replace) {
        setSyllabus(parsed);
        setSelectedSyllabusSubject(null);
        setExpandedUnits({});
        alert(
          `Syllabus imported successfully!\n\n${totalSubjects} subjects\n${totalUnits} units`
        );
      }
    } catch (error) {
      console.error("PDF IMPORT ERROR:", error);
      alert(`Could not read the PDF.\n\n${error?.message || String(error)}`);
    }

    setUploadingPdf(false);
    event.target.value = "";
  }

  // =========================================================
  // TIMETABLE
  // =========================================================

  function resetTimetableForm() {
    setTimetableForm({
      day: "Monday",
      subject: subjects[0]?.name || "",
      startTime: "09:00",
      endTime: "10:00",
      room: "",
      teacher: "",
    });
    setEditingTimetableId(null);
  }

  function openTimetableForm(entry = null) {
    if (entry) {
      setEditingTimetableId(entry.id);
      setTimetableForm({
        day: entry.day,
        subject: entry.subject,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.room || "",
        teacher: entry.teacher || "",
      });
    } else {
      resetTimetableForm();
    }
    setShowTimetableForm(true);
  }

  function saveTimetableEntry() {
    const subject = timetableForm.subject.trim();

    if (!subject || !timetableForm.startTime || !timetableForm.endTime) {
      alert("Please select a subject and enter the class time.");
      return;
    }

    if (timetableForm.startTime >= timetableForm.endTime) {
      alert("End time must be later than start time.");
      return;
    }

    const entry = {
      ...timetableForm,
      subject,
      id: editingTimetableId || Date.now(),
    };

    setTimetable((prev) =>
      editingTimetableId
        ? prev.map((item) => (item.id === editingTimetableId ? entry : item))
        : [...prev, entry]
    );

    setShowTimetableForm(false);
    resetTimetableForm();
  }

  function deleteTimetableEntry(id) {
    setTimetable((prev) => prev.filter((entry) => entry.id !== id));
  }

  function getDayEntries(day) {
    return timetable
      .filter((entry) => entry.day === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // =========================================================
  // SYLLABUS PROGRESS
  // =========================================================

  function getSubjectProgress(subject) {
    const topics = subject.units.flatMap((unit) => unit.topics);
    if (topics.length === 0) return 0;
    const completed = topics.filter((topic) => topic.completed).length;
    return Math.round((completed / topics.length) * 100);
  }

  function getOverallSyllabusProgress() {
    if (!syllabus) return 0;

    const allSubjects = [
      ...(syllabus.semester1 || []),
      ...(syllabus.semester2 || []),
    ];

    const topics = allSubjects.flatMap((subject) =>
      subject.units.flatMap((unit) => unit.topics)
    );

    if (topics.length === 0) return 0;

    const completed = topics.filter((topic) => topic.completed).length;
    return Math.round((completed / topics.length) * 100);
  }

  function updateSubjectInSyllabus(subjectId, updater) {
    setSyllabus((prev) => {
      if (!prev) return prev;

      const updateSemester = (list) =>
        list.map((subject) =>
          subject.id === subjectId ? updater(subject) : subject
        );

      return {
        semester1: updateSemester(prev.semester1 || []),
        semester2: updateSemester(prev.semester2 || []),
      };
    });
  }

  function toggleTopic(subjectId, unitId, topicId) {
    updateSubjectInSyllabus(subjectId, (subject) => ({
      ...subject,
      units: subject.units.map((unit) =>
        unit.id !== unitId
          ? unit
          : {
              ...unit,
              topics: unit.topics.map((topic) =>
                topic.id === topicId
                  ? { ...topic, completed: !topic.completed }
                  : topic
              ),
            }
      ),
    }));
  }

  function toggleUnit(unitId) {
    setExpandedUnits((prev) => ({
      ...prev,
      [unitId]: !prev[unitId],
    }));
  }

  function addManualTopic(subjectId, unitId) {
    const name = newTopic.trim();
    if (!name) return;

    updateSubjectInSyllabus(subjectId, (subject) => ({
      ...subject,
      units: subject.units.map((unit) =>
        unit.id !== unitId
          ? unit
          : {
              ...unit,
              topics: [
                ...unit.topics,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  name,
                  completed: false,
                },
              ],
            }
      ),
    }));

    setNewTopic("");
  }

  // =========================================================
  // PRODUCTIVITY HELPERS
  // =========================================================

  const todayKey = getLocalDateKey();

  const todayStudyMinutes = useMemo(
    () =>
      studySessions
        .filter((session) => session.date === todayKey)
        .reduce((total, session) => total + Number(session.duration || 0), 0),
    [studySessions, todayKey]
  );

  const sessionsToday = useMemo(
    () =>
      studySessions.filter(
        (session) => session.date === todayKey && session.type === "focus"
      ).length,
    [studySessions, todayKey]
  );

  const totalStudyMinutes = useMemo(
    () =>
      studySessions.reduce(
        (total, session) => total + Number(session.duration || 0),
        0
      ),
    [studySessions]
  );

  const weeklyStudyMinutes = useMemo(() => {
    // Start of the day 6 days ago, so "last 7 days" includes whole days
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);

    return studySessions
      .filter((session) => {
        const sessionDate = new Date(`${session.date}T12:00:00`);
        return sessionDate >= weekStart;
      })
      .reduce((total, session) => total + Number(session.duration || 0), 0);
  }, [studySessions]);

  const studyStreak = useMemo(() => {
    const dates = new Set(studySessions.map((session) => session.date));
    let streak = 0;
    const current = new Date();

    // Haven't studied yet today? The streak is still alive from yesterday.
    if (!dates.has(getLocalDateKey(current))) {
      current.setDate(current.getDate() - 1);
    }

    while (dates.has(getLocalDateKey(current))) {
      streak++;
      current.setDate(current.getDate() - 1);
    }

    return streak;
  }, [studySessions]);

  const subjectStudyTotals = useMemo(
    () =>
      subjects.map((subject) => ({
        name: subject.name,
        minutes: studySessions
          .filter((session) => session.subject === subject.name)
          .reduce(
            (total, session) => total + Number(session.duration || 0),
            0
          ),
      })),
    [subjects, studySessions]
  );

  const maxSubjectStudyMinutes = Math.max(
    ...subjectStudyTotals.map((item) => item.minutes),
    1
  );

  function clearStudyHistory() {
    if (!studySessions.length) return;

    const confirmed = window.confirm(
      "Clear all recorded study sessions? This cannot be undone."
    );

    if (confirmed) {
      setStudySessions([]);
    }
  }

  // =========================================================
  // DASHBOARD
  // =========================================================

  function Dashboard() {
    const goal = Math.max(1, Number(settings.dailyStudyGoal) || 180);
    const goalProgress = Math.min(100, (todayStudyMinutes / goal) * 100);
    const greeting =
      new Date().getHours() < 12
        ? "Good morning"
        : new Date().getHours() < 18
        ? "Good afternoon"
        : "Good evening";

    return (
      <>
        <div className="dashboard-welcome">
          <h2>
            {greeting}
            {settings.studentName ? `, ${settings.studentName}` : ""} 👋
          </h2>
          <p>Stay consistent. Small sessions add up.</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span>Overall Attendance</span>
            <strong>{overallAttendance()}%</strong>
          </div>
          <div className="stat-card">
            <span>Syllabus Progress</span>
            <strong>{getOverallSyllabusProgress()}%</strong>
          </div>
          <div className="stat-card">
            <span>Today's Study</span>
            <strong>{formatStudyTime(todayStudyMinutes)}</strong>
          </div>
          <div className="stat-card">
            <span>Study Streak</span>
            <strong>🔥 {studyStreak}</strong>
          </div>
        </div>

        <div className="productivity-grid">
          <PomodoroTimer
            pomodoro={pomodoro}
            subjects={subjects}
            sessionsToday={sessionsToday}
          />

          <div className="productivity-side">
            <div className="productivity-mini-card">
              <span className="mini-label">Daily Goal</span>
              <strong className="mini-value">
                {formatStudyTime(todayStudyMinutes)}
              </strong>
              <span className="mini-sub">
                Goal: {formatStudyTime(goal)}
              </span>
              <div className="small-progress">
                <div style={{ width: `${goalProgress}%` }} />
              </div>
            </div>

            <div className="productivity-mini-card">
              <span className="mini-label">This Week</span>
              <strong className="mini-value">
                {formatStudyTime(weeklyStudyMinutes)}
              </strong>
              <span className="mini-sub">Last 7 days</span>
            </div>

            <div className="productivity-mini-card streak-card">
              <span className="mini-label">Current Streak</span>
              <strong className="mini-value">
                <span className="streak-fire">🔥</span> {studyStreak}{" "}
                {studyStreak === 1 ? "day" : "days"}
              </strong>
              <span className="mini-sub">Consecutive study days</span>
            </div>
          </div>
        </div>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Subject Overview</h2>
              <p>Keep an eye on attendance and study time.</p>
            </div>
          </div>

          <div className="dashboard-subjects">
            {subjects.map((subject) => {
              const studyTime =
                subjectStudyTotals.find((item) => item.name === subject.name)
                  ?.minutes || 0;

              return (
                <div className="dashboard-subject" key={subject.id}>
                  <div>
                    <strong>{subject.name}</strong>
                    <span>
                      Attendance: {getPercentage(subject)}% · Study:{" "}
                      {formatStudyTime(studyTime)}
                    </span>
                  </div>
                  <div className="dashboard-attendance">
                    {getPercentage(subject)}%
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))",
            gap: "20px",
            marginTop: "20px",
          }}
        >
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Study by Subject</h2>
                <p>Where your study time is going.</p>
              </div>
            </div>

            {studySessions.length === 0 ? (
              <p className="empty">
                Start a focus session to see your study distribution.
              </p>
            ) : (
              subjectStudyTotals.map((item) => (
                <div className="study-subject-row" key={item.name}>
                  <div className="study-subject-header">
                    <span>{item.name}</span>
                    <strong>{formatStudyTime(item.minutes)}</strong>
                  </div>
                  <div className="study-subject-bar">
                    <div
                      style={{
                        width: `${
                          (item.minutes / maxSubjectStudyMinutes) * 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Achievements</h2>
                <p>Your StudyTrack milestones.</p>
              </div>
            </div>

            <div className="achievement-grid">
              <div className={`achievement ${totalStudyMinutes < 60 ? "locked" : ""}`}>
                <span className="achievement-icon">⏱️</span>
                <strong>First Hour</strong>
              </div>
              <div className={`achievement ${studyStreak < 3 ? "locked" : ""}`}>
                <span className="achievement-icon">🔥</span>
                <strong>3 Day Streak</strong>
              </div>
              <div className={`achievement ${totalStudyMinutes < 600 ? "locked" : ""}`}>
                <span className="achievement-icon">📚</span>
                <strong>10 Hours</strong>
              </div>
              <div className={`achievement ${studyStreak < 7 ? "locked" : ""}`}>
                <span className="achievement-icon">🏆</span>
                <strong>7 Day Streak</strong>
              </div>
              <div className={`achievement ${totalStudyMinutes < 3000 ? "locked" : ""}`}>
                <span className="achievement-icon">🚀</span>
                <strong>50 Hours</strong>
              </div>
              <div
                className={`achievement ${
                  todayStudyMinutes < goal ? "locked" : ""
                }`}
              >
                <span className="achievement-icon">🎯</span>
                <strong>Daily Goal</strong>
              </div>
            </div>
          </section>
        </div>

        <section className="panel" style={{ marginTop: "20px" }}>
          <div className="panel-header">
            <div>
              <h2>Recent Study Sessions</h2>
              <p>Your latest focus sessions.</p>
            </div>
            {studySessions.length > 0 && (
              <button className="danger-text" onClick={clearStudyHistory}>
                Clear History
              </button>
            )}
          </div>

          {studySessions.length === 0 ? (
            <p className="empty">No study sessions yet.</p>
          ) : (
            <div className="study-history">
              {[...studySessions]
                .slice(-7)
                .reverse()
                .map((session) => (
                  <div className="study-history-row" key={session.id}>
                    <div>
                      <strong>{session.subject}</strong>
                      <div className="study-history-date">
                        {session.date}
                      </div>
                    </div>
                    <div className="study-history-time">
                      {formatStudyTime(session.duration)}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </>
    );
  }

  // =========================================================
  // ATTENDANCE PAGE
  // =========================================================

  function Attendance() {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Attendance</h1>
            <p>Track attendance for every subject.</p>
          </div>
          <button
            className="primary-button"
            onClick={() => setShowAdd(!showAdd)}
          >
            + Add Subject
          </button>
        </div>

        {showAdd && (
          <div className="panel add-form">
            <h2>Add Subject</h2>
            <input
              type="text"
              placeholder="Subject name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              type="number"
              min="0"
              max="100"
              placeholder="Benchmark %"
              value={newBenchmark}
              onChange={(e) => setNewBenchmark(e.target.value)}
            />
            <button className="primary-button" onClick={addSubject}>
              Add Subject
            </button>
          </div>
        )}

        <div className="attendance-list">
          {subjects.map((subject) => {
            const percentage = getPercentage(subject);
            const needed = getClassesNeeded(subject);
            const canMiss = getClassesCanMiss(subject);

            return (
              <div className="attendance-card" key={subject.id}>
                <div className="attendance-card-header">
                  <div>
                    <h2>{subject.name}</h2>
                    <span>{subject.present + subject.absent} total classes</span>
                  </div>
                  <button
                    className="danger-text"
                    onClick={() => deleteSubject(subject.id)}
                  >
                    Delete
                  </button>
                </div>

                <div className="attendance-main">
                  <div className="big-percentage">{percentage}%</div>
                  <p
                    className={
                      percentage >= subject.benchmark
                        ? "good-text"
                        : "danger-text"
                    }
                  >
                    {percentage >= subject.benchmark
                      ? "Above your benchmark"
                      : "Below your benchmark"}
                  </p>
                </div>

                <div className="benchmark-box">
                  <label>
                    Benchmark
                    <div className="benchmark-input">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={subject.benchmark}
                        onChange={(e) =>
                          updateBenchmark(subject.id, e.target.value)
                        }
                      />
                      <span>%</span>
                    </div>
                  </label>
                </div>

                <div className="large-progress">
                  <div style={{ width: `${Math.min(percentage, 100)}%` }} />
                </div>

                <div className="attendance-numbers">
                  <span>
                    Present: <strong>{subject.present}</strong>
                  </span>
                  <span>
                    Absent: <strong>{subject.absent}</strong>
                  </span>
                  <span>
                    Total: <strong>{subject.present + subject.absent}</strong>
                  </span>
                </div>

                <div className="attendance-actions">
                  <button
                    className="present-button"
                    onClick={() => markAttendance(subject.id, "present")}
                  >
                    + Present
                  </button>
                  <button
                    className="absent-button"
                    onClick={() => markAttendance(subject.id, "absent")}
                  >
                    + Absent
                  </button>
                </div>

                <div className="attendance-message">
                  {percentage < subject.benchmark ? (
                    needed === Infinity ? (
                      <span>100% attendance is required.</span>
                    ) : (
                      <span>
                        Attend the next <strong>{needed}</strong> classes to
                        reach <strong>{subject.benchmark}%</strong>.
                      </span>
                    )
                  ) : canMiss === Infinity ? (
                    <span>You can miss any number of classes.</span>
                  ) : (
                    <span>
                      You can miss <strong>{canMiss}</strong> class
                      {canMiss !== 1 ? "es" : ""} and stay at{" "}
                      <strong>{subject.benchmark}%</strong>.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // =========================================================
  // SYLLABUS PAGE
  // =========================================================

  function renderSemesterSubjects(list) {
    return (
      <div className="syllabus-subject-grid">
        {(list || []).map((subject) => (
          <button
            key={subject.id}
            className={`syllabus-subject-card ${
              selectedSyllabusSubject === subject.id ? "selected" : ""
            }`}
            onClick={() => setSelectedSyllabusSubject(subject.id)}
          >
            <strong>{subject.name}</strong>
            <span>{getSubjectProgress(subject)}%</span>
            <div className="small-progress">
              <div style={{ width: `${getSubjectProgress(subject)}%` }} />
            </div>
          </button>
        ))}
      </div>
    );
  }

  function Syllabus() {
    const allSubjects = syllabus
      ? [...(syllabus.semester1 || []), ...(syllabus.semester2 || [])]
      : [];

    const selectedSubject = allSubjects.find(
      (subject) => subject.id === selectedSyllabusSubject
    );

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Syllabus</h1>
            <p>Track your complete college syllabus.</p>
          </div>
          <label className="pdf-upload-button">
            {uploadingPdf ? "Reading PDF..." : "📄 Upload Complete Syllabus"}
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={uploadingPdf}
              onChange={handleWholePdfUpload}
            />
          </label>
        </div>

        {!syllabus ? (
          <div className="panel empty-state">
            <div className="empty-icon">📚</div>
            <h2>Upload your syllabus</h2>
            <p>
              Upload the complete IET DAVV syllabus PDF once. The app will
              separate Semester I, Semester II, subjects, units and topics
              automatically.
            </p>
            <label className="pdf-upload-button">
              📄 Choose PDF
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleWholePdfUpload}
              />
            </label>
          </div>
        ) : (
          <>
            <div className="syllabus-overall-card">
              <div>
                <span>Overall Syllabus Progress</span>
                <strong>{getOverallSyllabusProgress()}%</strong>
              </div>
              <div className="large-progress">
                <div
                  style={{ width: `${getOverallSyllabusProgress()}%` }}
                />
              </div>
            </div>

            <div className="semester-tabs">
              <div>
                <h2>Semester I</h2>
                {renderSemesterSubjects(syllabus.semester1)}
              </div>
              <div>
                <h2>Semester II</h2>
                {renderSemesterSubjects(syllabus.semester2)}
              </div>
            </div>

            {selectedSubject && (
              <div className="panel selected-syllabus">
                <div className="selected-syllabus-header">
                  <div>
                    <h2>{selectedSubject.name}</h2>
                    <span>{selectedSubject.code}</span>
                  </div>
                  <strong>{getSubjectProgress(selectedSubject)}%</strong>
                </div>

                <div className="large-progress">
                  <div
                    style={{
                      width: `${getSubjectProgress(selectedSubject)}%`,
                    }}
                  />
                </div>

                <div className="unit-list">
                  {selectedSubject.units.map((unit) => {
                    const completed = unit.topics.filter(
                      (topic) => topic.completed
                    ).length;

                    return (
                      <div className="unit-card" key={unit.id}>
                        <button
                          className="unit-header"
                          onClick={() => toggleUnit(unit.id)}
                        >
                          <div>
                            <strong>{unit.name}</strong>
                            <span>
                              {completed} / {unit.topics.length} completed
                            </span>
                          </div>
                          <span>
                            {expandedUnits[unit.id] ? "▲" : "▼"}
                          </span>
                        </button>

                        {expandedUnits[unit.id] && (
                          <div className="unit-topics">
                            {unit.topics.map((topic) => (
                              <label
                                className={`syllabus-topic ${
                                  topic.completed ? "completed" : ""
                                }`}
                                key={topic.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={topic.completed}
                                  onChange={() =>
                                    toggleTopic(
                                      selectedSubject.id,
                                      unit.id,
                                      topic.id
                                    )
                                  }
                                />
                                <span>{topic.name}</span>
                              </label>
                            ))}

                            <div className="manual-topic">
                              <input
                                type="text"
                                placeholder="Add topic..."
                                value={newTopic}
                                onChange={(e) => setNewTopic(e.target.value)}
                              />
                              <button
                                className="secondary-button"
                                onClick={() =>
                                  addManualTopic(
                                    selectedSubject.id,
                                    unit.id
                                  )
                                }
                              >
                                + Add
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  // =========================================================
  // TIMETABLE PAGE
  // =========================================================

  function Timetable() {
    const totalClasses = timetable.length;

    const setField = (key) => (e) =>
      setTimetableForm((prev) => ({ ...prev, [key]: e.target.value }));

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Timetable</h1>
            <p>Plan your weekly classes in one place.</p>
          </div>
          <button
            className="primary-button"
            onClick={() => openTimetableForm()}
          >
            + Add Class
          </button>
        </div>

        <div className="stats-grid cols-3">
          <div className="stat-card">
            <span>Weekly Classes</span>
            <strong>{totalClasses}</strong>
          </div>
          <div className="stat-card">
            <span>Days Scheduled</span>
            <strong>
              {DAYS.filter((day) => getDayEntries(day).length > 0).length}
            </strong>
          </div>
          <div className="stat-card">
            <span>Subjects Scheduled</span>
            <strong>
              {new Set(timetable.map((entry) => entry.subject)).size}
            </strong>
          </div>
        </div>

        {showTimetableForm && (
          <div className="panel timetable-form">
            <div className="panel-header">
              <div>
                <h2>{editingTimetableId ? "Edit Class" : "Add Class"}</h2>
                <p>Enter the details for this weekly class.</p>
              </div>
              <button
                className="danger-text"
                onClick={() => {
                  setShowTimetableForm(false);
                  resetTimetableForm();
                }}
              >
                Cancel
              </button>
            </div>

            <div className="form-grid">
              <label>
                Day
                <select value={timetableForm.day} onChange={setField("day")}>
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Subject
                <select
                  value={timetableForm.subject}
                  onChange={setField("subject")}
                >
                  <option value="">Select subject</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.name}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Start time
                <input
                  type="time"
                  value={timetableForm.startTime}
                  onChange={setField("startTime")}
                />
              </label>

              <label>
                End time
                <input
                  type="time"
                  value={timetableForm.endTime}
                  onChange={setField("endTime")}
                />
              </label>

              <label>
                Room
                <input
                  type="text"
                  placeholder="e.g. Lab 2"
                  value={timetableForm.room}
                  onChange={setField("room")}
                />
              </label>

              <label>
                Teacher
                <input
                  type="text"
                  placeholder="Optional"
                  value={timetableForm.teacher}
                  onChange={setField("teacher")}
                />
              </label>
            </div>

            <button className="primary-button" onClick={saveTimetableEntry}>
              {editingTimetableId ? "Save Changes" : "Add Class"}
            </button>
          </div>
        )}

        {timetable.length === 0 ? (
          <div className="panel empty-state">
            <div className="empty-icon">🗓️</div>
            <h2>Your timetable is empty</h2>
            <p>
              Add your weekly classes and they will stay saved in this browser.
            </p>
            <button
              className="primary-button"
              onClick={() => openTimetableForm()}
            >
              + Add Your First Class
            </button>
          </div>
        ) : (
          <div className="timetable-grid">
            {DAYS.map((day) => {
              const entries = getDayEntries(day);

              return (
                <section key={day} className="panel">
                  <div className="panel-header">
                    <h2>{day}</h2>
                    <span>
                      {entries.length} class
                      {entries.length === 1 ? "" : "es"}
                    </span>
                  </div>

                  {entries.length === 0 ? (
                    <div className="timetable-empty">No classes</div>
                  ) : (
                    <div className="timetable-list">
                      {entries.map((entry) => (
                        <div key={entry.id} className="timetable-class">
                          <strong className="timetable-class-name">
                            {entry.subject}
                          </strong>

                          <div className="timetable-class-meta">
                            <span>
                              🕐 {entry.startTime} – {entry.endTime}
                            </span>
                            {entry.room && <span>📍 {entry.room}</span>}
                            {entry.teacher && <span>👨‍🏫 {entry.teacher}</span>}
                          </div>

                          <div className="timetable-class-actions">
                            <button
                              className="secondary-button"
                              onClick={() => openTimetableForm(entry)}
                            >
                              Edit
                            </button>
                            <button
                              className="danger-text"
                              onClick={() => deleteTimetableEntry(entry.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // =========================================================
  // SETTINGS / BACKUP
  // =========================================================

  function updateSetting(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function exportBackup() {
    const backup = {
      app: "StudyTrack",
      version: 2,
      exportedAt: new Date().toISOString(),
      subjects,
      syllabus,
      timetable,
      settings,
      studySessions,
      pomodoro: pomodoro.settings,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studytrack-backup-${getLocalDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleBackupImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingBackup(true);

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result);

        if (backup.app !== "StudyTrack" || !Array.isArray(backup.subjects)) {
          throw new Error("This is not a valid StudyTrack backup.");
        }

        const replace = window.confirm(
          "Import this backup? Your current StudyTrack data will be replaced."
        );

        if (!replace) return;

        setSubjects(backup.subjects);
        setSyllabus(backup.syllabus || null);
        setTimetable(Array.isArray(backup.timetable) ? backup.timetable : []);
        setSettings({
          ...DEFAULT_SETTINGS,
          ...(backup.settings || {}),
        });
        setStudySessions(
          Array.isArray(backup.studySessions) ? backup.studySessions : []
        );
        pomodoro.applySettings(backup.pomodoro);
        setPage("dashboard");

        alert("Backup imported successfully!");
      } catch (error) {
        alert(`Could not import backup.\n\n${error.message || String(error)}`);
      } finally {
        setImportingBackup(false);
        event.target.value = "";
      }
    };

    reader.readAsText(file);
  }

  function resetAllData() {
    const confirmed = window.confirm(
      "Reset StudyTrack? This will permanently remove your attendance, syllabus, timetable, study history and settings from this browser."
    );

    if (!confirmed) return;

    setSubjects(DEFAULT_SUBJECTS);
    setSyllabus(null);
    setTimetable([]);
    setSettings(DEFAULT_SETTINGS);
    setStudySessions([]);
    setNewBenchmark(75);
    pomodoro.resetAll();
    setPage("dashboard");

    localStorage.removeItem("studytrack-subjects");
    localStorage.removeItem("studytrack-full-syllabus");
    localStorage.removeItem("studytrack-timetable");
    localStorage.removeItem("studytrack-settings");
    localStorage.removeItem("studytrack-sessions");
    localStorage.removeItem(POMODORO_STORAGE_KEY);

    alert("StudyTrack has been reset.");
  }

  function Settings() {
    const clamp = (value) => Math.min(100, Math.max(0, Number(value)));
    const goal = Math.max(1, Number(settings.dailyStudyGoal) || 180);

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Settings</h1>
            <p>Personalize StudyTrack and manage your data.</p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: "20px",
            maxWidth: "900px",
          }}
        >
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>👤 Student Profile</h2>
                <p>Your name is stored only in this browser for now.</p>
              </div>
            </div>

            <label>
              Student name
              <input
                type="text"
                placeholder="Enter your name"
                value={settings.studentName}
                onChange={(e) =>
                  updateSetting("studentName", e.target.value)
                }
              />
            </label>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>🎯 Attendance Preferences</h2>
                <p>These defaults are used for new attendance subjects.</p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                gap: "16px",
              }}
            >
              <label>
                Default benchmark (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings.defaultBenchmark}
                  onChange={(e) => {
                    const value = clamp(e.target.value);
                    updateSetting("defaultBenchmark", value);
                    setNewBenchmark(value);
                  }}
                />
              </label>

              <label>
                Warning threshold (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings.warningThreshold}
                  onChange={(e) =>
                    updateSetting(
                      "warningThreshold",
                      clamp(e.target.value)
                    )
                  }
                />
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>📚 Study Goal</h2>
                <p>Set how much focused study you want to complete each day.</p>
              </div>
            </div>

            <label>
              Daily study goal (minutes)
              <input
                type="number"
                min="1"
                max="1440"
                value={goal}
                onChange={(e) =>
                  updateSetting(
                    "dailyStudyGoal",
                    Math.min(1440, Math.max(1, Number(e.target.value) || 1))
                  )
                }
              />
            </label>

            <p style={{ marginTop: "10px", fontSize: "13px", opacity: 0.65 }}>
              Current goal: {formatStudyTime(goal)} per day.
            </p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>🌙 Appearance</h2>
                <p>
                  Choose how StudyTrack should remember your preferred theme.
                </p>
              </div>
            </div>

            <label>
              Theme
              <select
                value={settings.theme}
                onChange={(e) => updateSetting("theme", e.target.value)}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>

            <p style={{ marginTop: "10px", fontSize: "13px", opacity: 0.65 }}>
              The theme updates immediately and is remembered on this device.
            </p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>💾 Backup & Restore</h2>
                <p>
                  Save your attendance, syllabus, timetable, study history and
                  settings as one file.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <button className="primary-button" onClick={exportBackup}>
                ⬇️ Export Backup
              </button>

              <label
                className="secondary-button"
                style={{ cursor: "pointer" }}
              >
                {importingBackup ? "Importing..." : "⬆️ Import Backup"}
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  disabled={importingBackup}
                  onChange={handleBackupImport}
                />
              </label>
            </div>
          </div>

          <div
            className="panel"
            style={{ border: "1px solid rgba(239,68,68,0.35)" }}
          >
            <div className="panel-header">
              <div>
                <h2>🗑️ Reset App Data</h2>
                <p>This removes all StudyTrack data saved in this browser.</p>
              </div>
            </div>

            <button className="danger-text" onClick={resetAllData}>
              Reset all data
            </button>
          </div>
        </div>
      </>
    );
  }

  // =========================================================
  // STATISTICS PAGE
  // =========================================================

  function Statistics() {
    const totalPresent = subjects.reduce((sum, s) => sum + s.present, 0);
    const totalAbsent = subjects.reduce((sum, s) => sum + s.absent, 0);
    const totalClasses = totalPresent + totalAbsent;
    const overall =
      totalClasses > 0
        ? Math.round((totalPresent / totalClasses) * 100)
        : 0;

    const subjectStats = subjects.map((s) => ({
      ...s,
      percentage: getPercentage(s),
      total: s.present + s.absent,
    }));

    const scheduledBySubject = subjects.map((s) => ({
      name: s.name,
      count: timetable.filter((entry) => entry.subject === s.name).length,
    }));

    const maxScheduled = Math.max(
      ...scheduledBySubject.map((i) => i.count),
      1
    );

    const scheduledDays = DAYS.map((day) => ({
      day: day.slice(0, 3),
      count: getDayEntries(day).length,
    }));

    const maxDaily = Math.max(
      ...scheduledDays.map((i) => i.count),
      1
    );

    const goal = Math.max(1, Number(settings.dailyStudyGoal) || 180);
    const goalProgress = Math.min(
      100,
      (todayStudyMinutes / goal) * 100
    );

    const track = {
      height: "12px",
      background: "rgba(128,128,128,0.18)",
      borderRadius: "999px",
      overflow: "hidden",
    };

    const row = {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      marginBottom: "7px",
    };

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Statistics</h1>
            <p>See your attendance, study and timetable performance.</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span>Overall Attendance</span>
            <strong>{overall}%</strong>
          </div>
          <div className="stat-card">
            <span>Total Study Time</span>
            <strong>{formatStudyTime(totalStudyMinutes)}</strong>
          </div>
          <div className="stat-card">
            <span>This Week</span>
            <strong>{formatStudyTime(weeklyStudyMinutes)}</strong>
          </div>
          <div className="stat-card">
            <span>Study Streak</span>
            <strong>🔥 {studyStreak}</strong>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
            gap: "20px",
            marginTop: "20px",
          }}
        >
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Today's Goal</h2>
                <p>Focused study completed today.</p>
              </div>
            </div>

            <div className="big-percentage">
              {Math.round(goalProgress)}%
            </div>

            <div className="large-progress" style={{ marginTop: "14px" }}>
              <div style={{ width: `${goalProgress}%` }} />
            </div>

            <p style={{ marginTop: "12px", opacity: 0.7 }}>
              {formatStudyTime(todayStudyMinutes)} of{" "}
              {formatStudyTime(goal)}
            </p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Study by Subject</h2>
                <p>Your total recorded focus time.</p>
              </div>
            </div>

            {subjectStudyTotals.map((item) => (
              <div className="study-subject-row" key={item.name}>
                <div className="study-subject-header">
                  <span>{item.name}</span>
                  <strong>{formatStudyTime(item.minutes)}</strong>
                </div>
                <div className="study-subject-bar">
                  <div
                    style={{
                      width: `${
                        (item.minutes / maxSubjectStudyMinutes) * 100
                      }%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Attendance by Subject</h2>
                <p>Your current attendance percentage.</p>
              </div>
            </div>

            {subjectStats.length === 0 ? (
              <p>No subjects available yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "18px" }}>
                {subjectStats.map((item) => (
                  <div key={item.id}>
                    <div style={row}>
                      <strong>{item.name}</strong>
                      <strong>{item.percentage}%</strong>
                    </div>

                    <div style={track}>
                      <div
                        style={{
                          width: `${item.percentage}%`,
                          height: "100%",
                          background:
                            item.percentage >= item.benchmark
                              ? "#22c55e"
                              : "#f59e0b",
                          borderRadius: "999px",
                          transition: "width .4s ease",
                        }}
                      />
                    </div>

                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        opacity: 0.65,
                      }}
                    >
                      Target: {item.benchmark}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Present vs Absent</h2>
                <p>Class distribution for each subject.</p>
              </div>
            </div>

            {subjectStats.length === 0 ? (
              <p>No attendance data yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "18px" }}>
                {subjectStats.map((item) => {
                  const presentWidth = item.total
                    ? (item.present / item.total) * 100
                    : 0;

                  return (
                    <div key={item.id}>
                      <div style={row}>
                        <strong>{item.name}</strong>
                        <span style={{ fontSize: "12px", opacity: 0.7 }}>
                          {item.present} present · {item.absent} absent
                        </span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          height: "14px",
                          borderRadius: "999px",
                          overflow: "hidden",
                          background: "rgba(128,128,128,0.18)",
                        }}
                      >
                        <div
                          style={{
                            width: `${presentWidth}%`,
                            background: "#22c55e",
                          }}
                        />
                        <div style={{ flex: 1, background: "#ef4444" }} />
                      </div>
                    </div>
                  );
                })}

                <div
                  style={{
                    display: "flex",
                    gap: "18px",
                    fontSize: "13px",
                    opacity: 0.75,
                  }}
                >
                  <span>🟢 Present</span>
                  <span>🔴 Absent</span>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Attendance vs Benchmark</h2>
                <p>Compare your current percentage with your target.</p>
              </div>
            </div>

            {subjectStats.length === 0 ? (
              <p>No subjects available yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "16px" }}>
                {subjectStats.map((item) => (
                  <div key={item.id}>
                    <div style={{ ...row, marginBottom: "6px" }}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.percentage}% / {item.benchmark}%
                      </span>
                    </div>

                    <div
                      style={{
                        position: "relative",
                        height: "10px",
                        borderRadius: "999px",
                        background: "rgba(128,128,128,0.18)",
                      }}
                    >
                      <div
                        style={{
                          width: `${item.percentage}%`,
                          height: "100%",
                          borderRadius: "999px",
                          background:
                            item.percentage >= item.benchmark
                              ? "#22c55e"
                              : "#f59e0b",
                        }}
                      />

                      <div
                        style={{
                          position: "absolute",
                          left: `${item.benchmark}%`,
                          top: "-5px",
                          width: "3px",
                          height: "20px",
                          background: "currentColor",
                          borderRadius: "3px",
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Classes by Subject</h2>
                <p>Weekly classes from your timetable.</p>
              </div>
            </div>

            {timetable.length === 0 ? (
              <p>No timetable classes added yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                {scheduledBySubject
                  .filter((item) => item.count > 0)
                  .map((item) => (
                    <div key={item.name}>
                      <div style={{ ...row, marginBottom: "6px" }}>
                        <strong>{item.name}</strong>
                        <span>{item.count}</span>
                      </div>

                      <div style={{ ...track, height: "10px" }}>
                        <div
                          style={{
                            width: `${(item.count / maxScheduled) * 100}%`,
                            height: "100%",
                            background: "#6366f1",
                            borderRadius: "999px",
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="panel" style={{ gridColumn: "1 / -1" }}>
            <div className="panel-header">
              <div>
                <h2>Weekly Class Distribution</h2>
                <p>How your scheduled classes are spread across the week.</p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6,minmax(0,1fr))",
                gap: "14px",
                alignItems: "end",
                minHeight: "190px",
              }}
            >
              {scheduledDays.map((item) => (
                <div
                  key={item.day}
                  style={{
                    height: "170px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <strong>{item.count}</strong>
                  <div
                    style={{
                      width: "min(44px,70%)",
                      height: `${Math.max(
                        item.count
                          ? (item.count / maxDaily) * 120
                          : 4,
                        4
                      )}px`,
                      background: "#22d3ee",
                      borderRadius: "10px 10px 4px 4px",
                      transition: "height .4s ease",
                    }}
                  />
                  <span style={{ fontSize: "12px", opacity: 0.7 }}>
                    {item.day}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel" style={{ gridColumn: "1 / -1" }}>
            <div className="panel-header">
              <div>
                <h2>Recent Study Sessions</h2>
                <p>Your latest recorded focus sessions.</p>
              </div>
            </div>

            {studySessions.length === 0 ? (
              <p className="empty">No study sessions recorded yet.</p>
            ) : (
              <div className="study-history">
                {[...studySessions]
                  .slice(-10)
                  .reverse()
                  .map((session) => (
                    <div className="study-history-row" key={session.id}>
                      <div>
                        <strong>{session.subject}</strong>
                        <div className="study-history-date">
                          {session.date}
                        </div>
                      </div>
                      <div className="study-history-time">
                        {formatStudyTime(session.duration)}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // =========================================================
  // APP SHELL
  // =========================================================

  function navigateTo(nextPage) {
    setPage(nextPage);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const NAV = [
    ["dashboard", "🏠 Dashboard"],
    ["attendance", "📊 Attendance"],
    ["syllabus", "📚 Syllabus"],
    ["timetable", "🗓️ Timetable"],
    ["statistics", "📈 Statistics"],
    ["settings", "⚙️ Settings"],
  ];

  return (
    <div className={`app-shell ${mobileNavOpen ? "nav-open" : ""}`}>
      {mobileNavOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">S</div>
          <div>
            <h2>StudyTrack</h2>
            <span>Student Dashboard</span>
          </div>
        </div>

        <nav>
          {NAV.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigateTo(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <button
          className="mobile-menu-button"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div key={page} className="page-transition">
          {page === "dashboard" && Dashboard()}
          {page === "attendance" && Attendance()}
          {page === "syllabus" && Syllabus()}
          {page === "timetable" && Timetable()}
          {page === "statistics" && Statistics()}
          {page === "settings" && Settings()}
        </div>
      </main>
    </div>
  );
}

export default App;
