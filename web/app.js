function show(el, data) {
  el.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function parseCsvNumbers(raw) {
  return raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => !Number.isNaN(v));
}

async function safeJson(res) {
  const body = await res.text();
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    return { error: body };
  }
}

document.getElementById("btnMondayTranscript").addEventListener("click", async () => {
  const status = document.getElementById("mondayStatus");
  const week_tag = document.getElementById("orchWeek").value.trim() || null;
  const source_label = document.getElementById("mondaySourceLabel").value.trim() || "monday-lecture";
  const transcript_text = document.getElementById("mondayTranscript").value.trim();

  if (!transcript_text || transcript_text.length < 30) {
    show(status, "Transcript must be at least 30 characters.");
    return;
  }

  show(status, "Ingesting Monday transcript...");
  const res = await fetch("/api/orchestrator/monday/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_text, week_tag, source_label }),
  });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnMondayAudio").addEventListener("click", async () => {
  const status = document.getElementById("mondayStatus");
  const week = document.getElementById("orchWeek").value.trim();
  const audio = document.getElementById("mondayAudio");

  if (!audio.files.length) {
    show(status, "Choose an audio file first.");
    return;
  }

  const form = new FormData();
  form.append("file", audio.files[0]);
  if (week) {
    form.append("week_tag", week);
  }

  show(status, "Transcribing audio and ingesting Monday notes...");
  const res = await fetch("/api/orchestrator/monday/audio", { method: "POST", body: form });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnTuesdayAlign").addEventListener("click", async () => {
  const status = document.getElementById("tuesdayStatus");
  const week_tag = document.getElementById("tuesdayWeek").value.trim();
  const syllabus_text = document.getElementById("syllabusText").value.trim();
  const max_topics = Number(document.getElementById("tuesdayTopics").value || "12");

  if (!week_tag) {
    show(status, "Week tag is required.");
    return;
  }
  if (!syllabus_text || syllabus_text.length < 30) {
    show(status, "Syllabus text must be at least 30 characters.");
    return;
  }

  show(status, "Running Tuesday alignment and updating emphasis weights...");
  const res = await fetch("/api/orchestrator/tuesday/align", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_tag, syllabus_text, max_topics }),
  });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnWednesdayExecute").addEventListener("click", async () => {
  const status = document.getElementById("wednesdayStatus");
  const week_tag = document.getElementById("wednesdayWeek").value.trim();
  const num_questions = Number(document.getElementById("wednesdayCount").value || "10");

  if (!week_tag) {
    show(status, "Week tag is required.");
    return;
  }

  show(status, "Generating Wednesday exam from aligned chunks...");
  const res = await fetch("/api/orchestrator/wednesday/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_tag, num_questions }),
  });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnRouter").addEventListener("click", async () => {
  const status = document.getElementById("routerStatus");
  const week_tag = document.getElementById("routerWeek").value.trim() || null;
  const marks = parseCsvNumbers(document.getElementById("routerMarks").value.trim());
  const feedback = document.getElementById("routerFeedback").value.trim();
  const study_habits = document.getElementById("routerHabits").value.trim();
  const attendanceRaw = document.getElementById("routerAttendance").value.trim();
  const prepRaw = document.getElementById("routerPrepDays").value.trim();
  const goal = document.getElementById("routerGoal").value.trim() || "Improve Wednesday exam outcomes";

  const attendance_ratio = attendanceRaw ? Number(attendanceRaw) : null;
  const preparation_window_days = prepRaw ? Number(prepRaw) : null;

  show(status, "Routing profile to specialized agent...");
  const res = await fetch("/api/orchestrator/router", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      week_tag,
      goal,
      profile: {
        marks,
        feedback,
        study_habits,
        attendance_ratio,
        preparation_window_days,
      },
    }),
  });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnVersions").addEventListener("click", async () => {
  const status = document.getElementById("versionsStatus");
  const week = document.getElementById("versionsWeek").value.trim();
  const limit = Number(document.getElementById("versionsLimit").value || "20");

  const query = new URLSearchParams();
  query.set("limit", String(limit));
  if (week) {
    query.set("week_tag", week);
  }

  show(status, "Loading knowledge revision history...");
  const res = await fetch(`/api/orchestrator/versions?${query.toString()}`);
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnIngest").addEventListener("click", async () => {
  const status = document.getElementById("ingestStatus");
  const fileInput = document.getElementById("pdf");
  const week = document.getElementById("ingestWeek").value.trim();

  if (!fileInput.files.length) {
    show(status, "Choose a PDF first.");
    return;
  }

  const form = new FormData();
  form.append("file", fileInput.files[0]);
  if (week) {
    form.append("week_tag", week);
  }

  show(status, "Uploading and indexing...");
  const res = await fetch("/api/ingest", { method: "POST", body: form });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnAsk").addEventListener("click", async () => {
  const status = document.getElementById("chatStatus");
  const cit = document.getElementById("citations");
  const week = document.getElementById("chatWeek").value.trim();
  const question = document.getElementById("question").value.trim();

  if (!question) {
    show(status, "Enter a question first.");
    return;
  }

  show(status, "Routing to persona and grounding answer...");
  cit.innerHTML = "";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, week_tag: week || null }),
  });
  const data = await safeJson(res);

  if (!res.ok) {
    show(status, `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
    return;
  }

  show(status, `Persona: ${data.persona}\nRouted by: ${data.routed_by}\n\n${data.answer}`);

  if (Array.isArray(data.citations) && data.citations.length) {
    const lines = data.citations
      .map((c) => `<li>${c.lineage_link}</li>`)
      .join("");
    cit.innerHTML = `<strong>Source lineage:</strong><ul>${lines}</ul>`;
  }
});

document.getElementById("btnExam").addEventListener("click", async () => {
  const status = document.getElementById("examStatus");
  const week_tag = document.getElementById("examWeek").value.trim();
  const num_questions = Number(document.getElementById("examCount").value);

  if (!week_tag) {
    show(status, "Week tag is required for Wednesday mock generation.");
    return;
  }

  show(status, "Generating AQPGS paper...");
  const res = await fetch("/api/exam/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_tag, num_questions }),
  });
  const data = await safeJson(res);
  show(status, res.ok ? data : `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
});

document.getElementById("btnAudit").addEventListener("click", async () => {
  const status = document.getElementById("auditStatus");
  show(status, "Loading audit events...");

  const res = await fetch("/api/audit/recent?limit=20");
  const data = await safeJson(res);

  if (!res.ok) {
    show(status, `Error ${res.status}\n${JSON.stringify(data, null, 2)}`);
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    show(status, "No audit events yet.");
    return;
  }

  const rendered = data
    .map((e) => `#${e.id} ${e.created_at} | ${e.event_type}\n${JSON.stringify(e.payload, null, 2)}`)
    .join("\n\n");
  show(status, rendered);
});
