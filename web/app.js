// ========== Utility Functions ==========
function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function safeJson(res) {
  const body = await res.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { error: body };
  }
}

function show(el, data) {
  if (!el) return;
  el.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function parseCsvNumbers(raw) {
  return raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => !Number.isNaN(v));
}

const uiState = {
  activeStep: 0,
  auditEvents: [],
  versions: [],
};

function updateStepperUI() {
  const panels = Array.from(document.querySelectorAll(".stepper-panel"));
  const fill = document.getElementById("stepperProgressFill");
  const progress = document.querySelector(".stepper-progress");
  if (!panels.length) return;

  const index = Math.max(0, Math.min(uiState.activeStep, panels.length - 1));
  uiState.activeStep = index;

  panels.forEach((panel, i) => {
    panel.classList.toggle("is-active", i === index);
  });

  const pct = ((index + 1) / panels.length) * 100;
  if (fill) fill.style.width = `${pct}%`;
  if (progress) progress.setAttribute("aria-valuenow", String(Math.round(pct)));
}

function bindStepperControls() {
  const prev = document.getElementById("btnStepperPrev");
  const next = document.getElementById("btnStepperNext");
  const panels = Array.from(document.querySelectorAll(".stepper-panel"));

  prev?.addEventListener("click", () => {
    uiState.activeStep -= 1;
    updateStepperUI();
  });

  next?.addEventListener("click", () => {
    uiState.activeStep += 1;
    updateStepperUI();
  });

  panels.forEach((panel) => {
    panel.addEventListener("click", () => {
      const idx = Number(panel.getAttribute("data-step") || "0");
      uiState.activeStep = idx;
      updateStepperUI();
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        uiState.activeStep += 1;
        updateStepperUI();
      }
      if (event.key === "ArrowLeft") {
        uiState.activeStep -= 1;
        updateStepperUI();
      }
    });
  });
}

// ========== Structured Renderers ==========

// Render Topic Weight Chips (Tuesday result)
function renderTopicWeights(container, topics, weights) {
  if (!Array.isArray(topics) || !weights) {
    container.innerHTML = "<p>No topic weights available.</p>";
    return;
  }
  
  const chips = topics
    .slice(0, 8)
    .map((topic, idx) => {
      const weight = weights[topic] || 1.0;
      const level = weight > 2 ? "high" : weight > 1.2 ? "med" : "low";
      const colors = {
        high: "background: #fca5a5;",
        med: "background: #fbbf24;",
        low: "background: #a1e3e3;"
      };
      return `
        <span style="display: inline-block; padding: 6px 12px; border-radius: 20px; 
                     font-size: 0.8rem; font-weight: 600; ${colors[level]} margin: 4px 4px;">
          ${escapeHtml(topic)} ×${weight.toFixed(1)}
        </span>
      `;
    })
    .join("");
  
  container.innerHTML = `<div>${chips}</div>`;
}

// Render Exam Question Cards (Wednesday result)
function renderExamQuestions(container, questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    container.innerHTML = "<p>No questions generated.</p>";
    return;
  }
  
  const cards = questions
    .map((q, idx) => {
      const difficulty = q.difficulty || "Medium";
      const bloom = q.bloom_level || "Remember";
      const sourceLineage = Array.isArray(q.source_lineage) ? q.source_lineage.join(", ") : q.source_lineage || "N/A";
      
      return `
        <div style="background: #f0f0f0; border-left: 4px solid #8b5cf6; padding: 12px; 
                    border-radius: 8px; margin-bottom: 12px;">
          <div style="display: flex; gap: 8px; margin-bottom: 8px; font-size: 0.8rem;">
            <span style="background: #dbeafe; color: #0c4a6e; padding: 2px 8px; border-radius: 4px;">
              ${escapeHtml(difficulty)}
            </span>
            <span style="background: #fce7f3; color: #831843; padding: 2px 8px; border-radius: 4px;">
              ${escapeHtml(bloom)}
            </span>
          </div>
          <p style="margin: 0 0 6px; font-size: 0.9rem; font-weight: 600;">
            Q${idx + 1}: ${escapeHtml(String(q.question).substring(0, 60))}...
          </p>
          <div style="background: #fff; padding: 8px; border-radius: 4px; font-size: 0.75rem; 
                      font-family: 'Courier New', monospace; color: #666;">
            ${escapeHtml(sourceLineage)}
          </div>
        </div>
      `;
    })
    .join("");
  
  container.innerHTML = `<div>${cards}</div>`;
}

// Render Agent Card + Loss-Run (Requirement card 04)
function renderAgentCardWithLossRun(container, data) {
  if (!data || !data.agent_name) {
    container.innerHTML = "<p>No agent routing data.</p>";
    return;
  }
  
  const agentBadgeColor = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#fb923c"][
    data.agent_id ? String(data.agent_id).charCodeAt(0) % 6 : 0
  ];
  
  const metCriteria = data.structured_loss_run?.criteria_met || [];
  const missedCriteria = data.structured_loss_run?.gaps_identified || [];
  const fixes = data.structured_loss_run?.fixes || [];
  
  const html = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <!-- Agent Card -->
      <div style="background: #2c2c2c; color: #fff; border-radius: 8px; padding: 16px;">
        <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; 
                    background: ${agentBadgeColor}; color: #fff; font-size: 1.2rem; font-weight: 800; 
                    border-radius: 50%; margin-bottom: 8px; font-family: 'Bricolage Grotesque', sans-serif;">
          ${escapeHtml(String(data.agent_id).charAt(0))}
        </div>
        <h4 style="margin: 8px 0; font-family: 'Bricolage Grotesque', sans-serif; font-size: 0.95rem;">
          ${escapeHtml(data.agent_name)}
        </h4>
        <div style="font-size: 0.7rem; font-weight: 700; background: rgba(107, 79, 168, 0.2); 
                    color: #b4a7d6; padding: 3px 8px; border-radius: 4px; display: inline-block; 
                    text-transform: uppercase; margin-bottom: 8px;">
          ${escapeHtml(data.routed_by || "rule-based")}
        </div>
        <p style="font-size: 0.85rem; color: #ccc; margin: 8px 0;">
          ${escapeHtml(data.rationale || "No rationale available")}
        </p>
        <p style="font-size: 0.8rem; color: #aaa; margin: 8px 0;">
          <strong>Action Plan:</strong> ${escapeHtml(data.action_plan || "Follow standard protocol")}
        </p>
      </div>
      
      <!-- Loss-Run Verdict -->
      <div style="background: #f0f0f0; border-radius: 8px; padding: 16px; font-size: 0.85rem;">
        <h4 style="margin: 0 0 12px; font-family: 'Bricolage Grotesque', sans-serif; font-size: 0.95rem;">
          Loss-Run Verdict
        </h4>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: #18864b; display: block; margin-bottom: 6px;">✓ Criteria Met</strong>
          ${metCriteria.map(c => `<div style="margin: 3px 0;">• ${escapeHtml(String(c))}</div>`).join("") || "<div style='color: #999;'>None identified</div>"}
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: #d93636; display: block; margin-bottom: 6px;">✕ Gaps</strong>
          ${missedCriteria.map(c => `<div style="margin: 3px 0;">• ${escapeHtml(String(c))} (−2 pts)</div>`).join("") || "<div style='color: #999;'>None identified</div>"}
        </div>
        
        <div>
          <strong style="color: #f59e0b; display: block; margin-bottom: 6px;">⚠ Fixes</strong>
          ${fixes.map(f => `<div style="margin: 3px 0;">• ${escapeHtml(String(f))}</div>`).join("") || "<div style='color: #999;'>None needed</div>"}
        </div>
      </div>
    </div>
  `;
  
  container.innerHTML = html;
}

// Render Audit Timeline
function renderAuditTimeline(container, events) {
  if (!Array.isArray(events) || events.length === 0) {
    container.innerHTML = "<p class='placeholder'>No audit events yet.</p>";
    return;
  }
  
  const dotColors = {
    ingest: "timeline-dot-purple",
    align: "timeline-dot-blue",
    exam: "timeline-dot-amber",
    chat: "timeline-dot-green",
    orchestrator: "timeline-dot-coral",
    router: "timeline-dot-blue"
  };
  
  const cards = events
    .map((e) => {
      const eventType = e.event_type || "unknown";
      const dotClass = Object.keys(dotColors).find(k => eventType.toLowerCase().includes(k)) || "timeline-dot-green";
      const payload = e.payload || {};
      
      const facts = [];
      if (payload.week_tag) facts.push(`Week: ${payload.week_tag}`);
      if (payload.student_id) facts.push(`Student: ${payload.student_id}`);
      if (payload.agent_name) facts.push(`Agent: ${payload.agent_name}`);
      if (payload.paragraphs_indexed) facts.push(`Indexed: ${payload.paragraphs_indexed}`);
      if (payload.generated) facts.push(`Q: ${payload.generated}`);
      if (payload.chunks_updated) facts.push(`Updated: ${payload.chunks_updated}`);
      
      return `
        <div class="timeline-event">
          <div class="timeline-dot ${dotColors[dotClass] || 'timeline-dot-green'}"></div>
          <div class="timeline-content">
            <div class="timeline-event-name">${escapeHtml(eventType)}</div>
            <div class="timeline-event-time">${escapeHtml(e.created_at || "")}</div>
            ${facts.length > 0 ? `<div class="timeline-facts">${facts.map(f => escapeHtml(f)).join(" • ")}</div>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
  
  container.innerHTML = cards;
}

// Render Knowledge Versions Timeline
function renderVersionsTimeline(container, versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    container.innerHTML = "<p class='placeholder'>No knowledge versions yet.</p>";
    return;
  }
  
  const cards = versions
    .map((v) => {
      const summary = v.summary || {};
      
      return `
        <div class="timeline-event">
          <div class="timeline-dot timeline-dot-purple"></div>
          <div class="timeline-content">
            <div class="timeline-event-name">Rev #${v.revision_id || "?"} – ${escapeHtml(v.stage || "unknown")}</div>
            <div class="timeline-event-time">${escapeHtml(v.created_at || "")} (Week: ${escapeHtml(v.week_tag || "?")})</div>
            <div class="timeline-facts">
              Chunks: ${summary.chunks_updated || 0} • Topics: ${summary.topics_analyzed?.length || 0}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
  
  container.innerHTML = cards;
}

function applyAuditFilters() {
  const container = document.getElementById("auditTimeline");
  const search = document.getElementById("auditSearch")?.value.trim().toLowerCase() || "";
  const type = document.getElementById("auditFilterType")?.value || "all";

  const filtered = uiState.auditEvents.filter((event) => {
    const et = String(event.event_type || "").toLowerCase();
    const payload = JSON.stringify(event.payload || {}).toLowerCase();
    const byType = type === "all" || et.includes(type);
    const bySearch = !search || et.includes(search) || payload.includes(search);
    return byType && bySearch;
  });

  renderAuditTimeline(container, filtered);
}

function applyVersionFilters() {
  const container = document.getElementById("versionsTimeline");
  const search = document.getElementById("versionSearch")?.value.trim().toLowerCase() || "";

  const filtered = uiState.versions.filter((version) => {
    const stage = String(version.stage || "").toLowerCase();
    const week = String(version.week_tag || "").toLowerCase();
    return !search || stage.includes(search) || week.includes(search);
  });

  renderVersionsTimeline(container, filtered);
}

function renderVersionDiff() {
  const out = document.getElementById("versionDiffOutput");
  const from = Number(document.getElementById("diffFromRevision")?.value || "0");
  const to = Number(document.getElementById("diffToRevision")?.value || "0");
  if (!out) return;

  if (!from || !to || from === to) {
    out.textContent = "Select two different revision IDs to compare.";
    return;
  }

  const fromVersion = uiState.versions.find((v) => Number(v.revision_id) === from);
  const toVersion = uiState.versions.find((v) => Number(v.revision_id) === to);
  if (!fromVersion || !toVersion) {
    out.textContent = "One or both revisions were not found in the current list.";
    return;
  }

  const fromSummary = fromVersion.summary || {};
  const toSummary = toVersion.summary || {};
  const keys = Array.from(new Set([...Object.keys(fromSummary), ...Object.keys(toSummary)])).sort();

  const lines = [
    `Comparing revision ${from} -> ${to}`,
    ""
  ];

  keys.forEach((key) => {
    const left = JSON.stringify(fromSummary[key]);
    const right = JSON.stringify(toSummary[key]);
    if (left !== right) {
      lines.push(`- ${key}: ${left}`);
      lines.push(`+ ${key}: ${right}`);
    }
  });

  if (lines.length === 2) {
    lines.push("No summary-level differences detected.");
  }
  out.textContent = lines.join("\n");
}

function bindGovernanceTools() {
  document.getElementById("auditSearch")?.addEventListener("input", applyAuditFilters);
  document.getElementById("auditFilterType")?.addEventListener("change", applyAuditFilters);
  document.getElementById("versionSearch")?.addEventListener("input", applyVersionFilters);
  document.getElementById("btnShowDiff")?.addEventListener("click", renderVersionDiff);
}


// ========== Event Listeners - Monday ==========
document.getElementById("btnMondayTranscript")?.addEventListener("click", async () => {
  const status = document.getElementById("mondayStatus");
  const week_tag = document.getElementById("mondayWeekTag")?.value.trim() || null;
  const source_label = document.getElementById("mondaySourceLabel")?.value.trim() || "monday-lecture";
  const transcript_text = document.getElementById("mondayTranscript")?.value.trim();

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
  
  if (res.ok) {
    show(status, `✓ Indexed ${data.paragraphs_indexed} paragraphs (Rev #${data.knowledge_revision})`);
  } else {
    show(status, `Error ${res.status}: ${JSON.stringify(data, null, 2)}`);
  }
});

// ========== Event Listeners - Tuesday ==========
document.getElementById("btnTuesdayAlign")?.addEventListener("click", async () => {
  const status = document.getElementById("tuesdayStatus");
  const result = document.getElementById("tuesdayResult");
  const week_tag = document.getElementById("tuesdayWeekTag")?.value.trim();
  const syllabus_text = document.getElementById("tuesdaySyllabusText")?.value.trim();
  const max_topics = Number(document.getElementById("tuesdayMaxTopics")?.value || "12");

  if (!week_tag || !syllabus_text || syllabus_text.length < 30) {
    show(status, "Week tag and syllabus text (30+ chars) required.");
    return;
  }

  show(status, "Running Tuesday alignment...");
  const res = await fetch("/api/orchestrator/tuesday/align", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_tag, syllabus_text, max_topics }),
  });
  const data = await safeJson(res);
  
  if (res.ok) {
    show(status, `✓ Aligned ${data.chunks_updated} chunks`);
    renderTopicWeights(result, data.topics_analyzed || [], data.keyword_weights || {});
  } else {
    show(status, `Error ${res.status}`);
  }
});

// ========== Event Listeners - Wednesday ==========
document.getElementById("btnWednesdayGenerate")?.addEventListener("click", async () => {
  const status = document.getElementById("wednesdayStatus");
  const result = document.getElementById("wednesdayResult");
  const week_tag = document.getElementById("wednesdayWeekTag")?.value.trim();
  const num_questions = Number(document.getElementById("wednesdayCount")?.value || "10");

  if (!week_tag) {
    show(status, "Week tag required.");
    return;
  }

  show(status, "Generating Wednesday exam...");
  const res = await fetch("/api/orchestrator/wednesday/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_tag, num_questions }),
  });
  const data = await safeJson(res);
  
  if (res.ok) {
    show(status, `✓ Generated ${data.questions?.length || 0} questions`);
    renderExamQuestions(result, data.questions || []);
  } else {
    show(status, `Error ${res.status}`);
  }
});

// ========== Event Listeners - Requirement Cards ==========

// Card 01: Logic Continuity
document.getElementById("btnReq01")?.addEventListener("click", async () => {
  const status = document.getElementById("req01Result");
  const week_tag = document.getElementById("req01WeekTag")?.value.trim();
  const source_label = document.getElementById("req01SourceLabel")?.value.trim() || "requirement-01";
  const text = document.getElementById("req01Text")?.value.trim();

  if (!text || text.length < 30) {
    show(status, "Text must be at least 30 characters.");
    return;
  }

  show(status, "Verifying logic continuity...");
  const res = await fetch("/api/ingest/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_label, text, week_tag }),
  });
  const data = await safeJson(res);
  
  if (res.ok) {
    show(status, `✓ Indexed ${data.paragraphs_indexed} paragraphs (Rev #${data.knowledge_revision})`);
  } else {
    show(status, `Error: ${JSON.stringify(data)}`);
  }
});

// Card 02: Rubric GPS
document.getElementById("btnReq02")?.addEventListener("click", async () => {
  const status = document.getElementById("req02Result");
  const student_id = document.getElementById("req02StudentId")?.value.trim();
  const week_tag = document.getElementById("req02WeekTag")?.value.trim();
  const question = document.getElementById("req02Question")?.value.trim();
  const draft_answer = document.getElementById("req02Answer")?.value.trim();

  if (!student_id || !week_tag || !question || !draft_answer) {
    show(status, "All fields required.");
    return;
  }

  show(status, "Running Rubric GPS...");
  const res = await fetch("/api/rubric/gps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id, week_tag, question, draft_answer }),
  });
  const data = await safeJson(res);
  
  if (res.ok) {
    const metCount = (data.met_criteria || []).length;
    const missedCount = (data.missed_criteria || []).length;
    show(status, `✓ Met: ${metCount} | Gaps: ${missedCount}`);
  } else {
    show(status, `Error: ${JSON.stringify(data)}`);
  }
});

// Card 03: Knowledge Depth
document.getElementById("btnReq03")?.addEventListener("click", async () => {
  const status = document.getElementById("req03Result");
  const result = document.getElementById("req03Result");
  const week_tag = document.getElementById("req03WeekTag")?.value.trim();
  const num_questions = Number(document.getElementById("req03Count")?.value || "5");

  if (!week_tag) {
    show(status, "Week tag required.");
    return;
  }

  show(status, "Generating knowledge depth paper...");
  const res = await fetch("/api/exam/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_tag, num_questions }),
  });
  const data = await safeJson(res);
  
  if (res.ok) {
    show(status, `✓ Generated ${data.questions?.length || 0} questions`);
    renderExamQuestions(result, data.questions || []);
  } else {
    show(status, `Error: ${JSON.stringify(data)}`);
  }
});

// Card 04: Router + Loss-Run
document.getElementById("btnReq04")?.addEventListener("click", async () => {
  const result = document.getElementById("req04Result");
  const student_id = document.getElementById("req04StudentId")?.value.trim();
  const marks = parseCsvNumbers(document.getElementById("req04Marks")?.value.trim() || "");
  const feedback = document.getElementById("req04Feedback")?.value.trim();
  const study_habits = document.getElementById("req04Habits")?.value.trim();
  const attendance = document.getElementById("req04Attendance")?.value.trim();
  const days_until_exam = document.getElementById("req04DaysUntilExam")?.value.trim();

  if (!student_id) {
    show(result, "Student ID required.");
    return;
  }

  const resultDiv = result;
  resultDiv.textContent = "Routing student profile...";

  const res = await fetch("/api/orchestrator/router", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: {
        student_id,
        marks,
        feedback,
        study_habits,
        attendance_ratio: attendance ? Number(attendance) : null,
        days_until_exam: days_until_exam ? Number(days_until_exam) : null
      },
    }),
  });
  const data = await safeJson(res);
  
  if (res.ok) {
    renderAgentCardWithLossRun(resultDiv, data);
  } else {
    show(resultDiv, `Error: ${JSON.stringify(data)}`);
  }
});

// ========== Event Listeners - Governance ==========
document.getElementById("btnRefreshAudit")?.addEventListener("click", async () => {
  const container = document.getElementById("auditTimeline");
  container.innerHTML = "<p class='placeholder'>Loading audit events...</p>";
  
  const res = await fetch("/api/audit/recent?limit=20");
  const data = await safeJson(res);
  
  if (res.ok) {
    uiState.auditEvents = Array.isArray(data) ? data : [];
    applyAuditFilters();
  } else {
    container.innerHTML = "<p class='error'>Failed to load audit events.</p>";
  }
});

document.getElementById("btnRefreshVersions")?.addEventListener("click", async () => {
  const container = document.getElementById("versionsTimeline");
  container.innerHTML = "<p class='placeholder'>Loading knowledge versions...</p>";
  
  const res = await fetch("/api/orchestrator/versions?limit=20");
  const data = await safeJson(res);
  
  if (res.ok && Array.isArray(data)) {
    uiState.versions = data;
    applyVersionFilters();
  } else {
    container.innerHTML = "<p class='error'>Failed to load versions.</p>";
  }
});

// Auto-load governance on page load
window.addEventListener("load", () => {
  bindStepperControls();
  bindGovernanceTools();
  updateStepperUI();

  const auditContainer = document.getElementById("auditTimeline");
  const versionsContainer = document.getElementById("versionsTimeline");
  
  if (auditContainer) {
    fetch("/api/audit/recent?limit=10")
      .then(res => safeJson(res))
      .then(data => {
        uiState.auditEvents = Array.isArray(data) ? data : [];
        applyAuditFilters();
      })
      .catch(() => {});
  }
  
  if (versionsContainer) {
    fetch("/api/orchestrator/versions?limit=10")
      .then(res => safeJson(res))
      .then(data => {
        uiState.versions = Array.isArray(data) ? data : [];
        applyVersionFilters();
      })
      .catch(() => {});
  }
});

