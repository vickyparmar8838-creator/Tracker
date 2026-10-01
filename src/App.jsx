import { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
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
  theme: "dark",
};

// =========================================================
// SYLLABUS PARSER (IET DAVV B.Tech I-year, scheme wef July 2024)
//
//  1. Strip the repeating page header so units spanning pages stay intact.
//  2. Every "UNIT-I" starts the content block of one course
//     (the scheme table on page 2 has no "Unit" text, so it is ignored).
//  3. Blocks are assigned to courses by order in the document, because some
//     course headers are printed AFTER their content and one code differs
//     (R2SES3 vs 2RCES3).
//  4. Workshop Practice has no units, so it is built from its trade-shop list.
// =========================================================

// Courses in the order their detail pages appear in the PDF.
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
    .replace(/^[•●▪◦*\-–—:,.\s]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[\s.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitUnitTopics(text) {
  // Split on ";", on " - " / " – " separators, and on sentence ends
  // (but not "i.e. Pp").
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
      const end = i + 1 < matches.length ? matches[i + 1].index : blockText.length;
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

// =========================================================
// APP
// =========================================================

function App() {
  const [page, setPage] = useState("dashboard");

  const [subjects, setSubjects] = useState(() => {
    const saved = localStorage.getItem("studytrack-subjects");
    return saved ? JSON.parse(saved) : DEFAULT_SUBJECTS;
  });

  /*
   * Syllabus structure:
   * { semester1: [{ id, name, code, units: [{ id, name, topics: [{ id, name, completed }] }] }],
   *   semester2: [...] }
   */
  const [syllabus, setSyllabus] = useState(() => {
    const saved = localStorage.getItem("studytrack-full-syllabus");
    return saved ? JSON.parse(saved) : null;
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
    const saved = localStorage.getItem("studytrack-timetable");
    return saved ? JSON.parse(saved) : [];
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
    const saved = localStorage.getItem("studytrack-settings");
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const [importingBackup, setImportingBackup] = useState(false);

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
    setNewBenchmark(75);
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
    setSubjects((prev) => prev.filter((subject) => subject.id !== id));
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
  // DASHBOARD
  // =========================================================

  function Dashboard() {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Good morning 👋</h1>
            <p>Here is your academic overview.</p>
          </div>
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
            <span>Subjects</span>
            <strong>{subjects.length}</strong>
          </div>

          <div className="stat-card">
            <span>Needs Attention</span>
            <strong>
              {
                subjects.filter(
                  (subject) => getPercentage(subject) < subject.benchmark
                ).length
              }
            </strong>
          </div>
        </div>

        <section className="panel">
          <div className="panel-header">
            <h2>Subject Overview</h2>
          </div>

          <div className="dashboard-subjects">
            {subjects.map((subject) => (
              <div className="dashboard-subject" key={subject.id}>
                <div>
                  <strong>{subject.name}</strong>
                  <span>Attendance: {getPercentage(subject)}%</span>
                </div>

                <div className="dashboard-attendance">
                  {getPercentage(subject)}%
                </div>
              </div>
            ))}
          </div>
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
                    <input
                      className="benchmark-input"
                      type="number"
                      min="0"
                      max="100"
                      value={subject.benchmark}
                      onChange={(e) =>
                        updateBenchmark(subject.id, e.target.value)
                      }
                    />
                    %
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
                <div style={{ width: `${getOverallSyllabusProgress()}%` }} />
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
                    style={{ width: `${getSubjectProgress(selectedSubject)}%` }}
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

                          <span>{expandedUnits[unit.id] ? "▲" : "▼"}</span>
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
                                  addManualTopic(selectedSubject.id, unit.id)
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

    const cardStyle = {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "16px",
      padding: "16px",
    };

    const setField = (key) => (e) =>
      setTimetableForm((prev) => ({ ...prev, [key]: e.target.value }));

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Timetable</h1>
            <p>Plan your weekly classes in one place.</p>
          </div>

          <button className="primary-button" onClick={() => openTimetableForm()}>
            + Add Class
          </button>
        </div>

        <div className="stats-grid">
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
          <div className="panel" style={{ marginBottom: "24px" }}>
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

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "14px",
              }}
            >
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

            <button
              className="primary-button"
              style={{ marginTop: "18px" }}
              onClick={saveTimetableEntry}
            >
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "16px",
            }}
          >
            {DAYS.map((day) => {
              const entries = getDayEntries(day);

              return (
                <section key={day} className="panel" style={{ margin: 0 }}>
                  <div className="panel-header">
                    <h2>{day}</h2>
                    <span>
                      {entries.length} class{entries.length === 1 ? "" : "es"}
                    </span>
                  </div>

                  {entries.length === 0 ? (
                    <div style={{ opacity: 0.55, padding: "14px 0" }}>
                      No classes
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: "12px" }}>
                      {entries.map((entry) => (
                        <div key={entry.id} style={cardStyle}>
                          <div style={{ fontWeight: 700, fontSize: "16px" }}>
                            {entry.subject}
                          </div>
                          <div style={{ marginTop: "7px", opacity: 0.85 }}>
                            🕐 {entry.startTime} – {entry.endTime}
                          </div>
                          {entry.room && (
                            <div style={{ marginTop: "5px", opacity: 0.75 }}>
                              📍 {entry.room}
                            </div>
                          )}
                          {entry.teacher && (
                            <div style={{ marginTop: "5px", opacity: 0.75 }}>
                              👨‍🏫 {entry.teacher}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              marginTop: "12px",
                            }}
                          >
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
      version: 1,
      exportedAt: new Date().toISOString(),
      subjects,
      syllabus,
      timetable,
      settings,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studytrack-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
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
        setSettings(backup.settings || DEFAULT_SETTINGS);
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
      "Reset StudyTrack? This will permanently remove your attendance, syllabus, timetable and settings from this browser."
    );

    if (!confirmed) return;

    setSubjects(DEFAULT_SUBJECTS);
    setSyllabus(null);
    setTimetable([]);
    setSettings(DEFAULT_SETTINGS);
    setNewBenchmark(75);
    setPage("dashboard");

    localStorage.removeItem("studytrack-subjects");
    localStorage.removeItem("studytrack-full-syllabus");
    localStorage.removeItem("studytrack-timetable");
    localStorage.removeItem("studytrack-settings");

    alert("StudyTrack has been reset.");
  }

  function Settings() {
    const clamp = (value) => Math.min(100, Math.max(0, Number(value)));

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Settings</h1>
            <p>Personalize StudyTrack and manage your data.</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: "20px", maxWidth: "900px" }}>
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
                onChange={(e) => updateSetting("studentName", e.target.value)}
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
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
                    updateSetting("warningThreshold", clamp(e.target.value))
                  }
                />
              </label>
            </div>
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
              Your current app styling remains unchanged; this preference is
              saved for future theme styling.
            </p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>💾 Backup & Restore</h2>
                <p>
                  Save your attendance, syllabus, timetable and settings as one
                  file.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button className="primary-button" onClick={exportBackup}>
                ⬇️ Export Backup
              </button>
              <label className="secondary-button" style={{ cursor: "pointer" }}>
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
      totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;

    const subjectStats = subjects.map((s) => ({
      ...s,
      percentage: getPercentage(s),
      total: s.present + s.absent,
    }));

    const scheduledBySubject = subjects.map((s) => ({
      name: s.name,
      count: timetable.filter((entry) => entry.subject === s.name).length,
    }));

    const maxScheduled = Math.max(...scheduledBySubject.map((i) => i.count), 1);

    const scheduledDays = DAYS.map((day) => ({
      day: day.slice(0, 3),
      count: getDayEntries(day).length,
    }));

    const maxDaily = Math.max(...scheduledDays.map((i) => i.count), 1);

    const track = {
      height: "12px",
      background: "rgba(128,128,128,0.18)",
      borderRadius: "999px",
      overflow: "hidden",
    };

    const row = {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: "7px",
    };

    return (
      <>
        <div className="page-header">
          <div>
            <h1>Statistics</h1>
            <p>See your attendance and timetable performance at a glance.</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span>Overall Attendance</span>
            <strong>{overall}%</strong>
          </div>
          <div className="stat-card">
            <span>Total Classes</span>
            <strong>{totalClasses}</strong>
          </div>
          <div className="stat-card">
            <span>Present</span>
            <strong>{totalPresent}</strong>
          </div>
          <div className="stat-card">
            <span>Absent</span>
            <strong>{totalAbsent}</strong>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))",
            gap: "20px",
            marginTop: "20px",
          }}
        >
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
                      style={{ marginTop: "6px", fontSize: "12px", opacity: 0.65 }}
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
                gridTemplateColumns: "repeat(6,minmax(45px,1fr))",
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
                        item.count ? (item.count / maxDaily) * 120 : 4,
                        4
                      )}px`,
                      background: "#8b5cf6",
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
        </div>
      </>
    );
  }

  // =========================================================
  // APP SHELL
  // =========================================================

  const NAV = [
    ["dashboard", "🏠 Dashboard"],
    ["attendance", "📊 Attendance"],
    ["syllabus", "📚 Syllabus"],
    ["timetable", "🗓️ Timetable"],
    ["statistics", "📈 Statistics"],
    ["settings", "⚙️ Settings"],
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">S</div>

          <div>
            <strong>StudyTrack</strong>
            <span>Student Dashboard</span>
          </div>
        </div>

        <nav>
          {NAV.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => setPage(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        {page === "dashboard" && Dashboard()}
        {page === "attendance" && Attendance()}
        {page === "syllabus" && Syllabus()}
        {page === "timetable" && Timetable()}
        {page === "statistics" && Statistics()}
        {page === "settings" && Settings()}
      </main>
    </div>
  );
}

export default App;
