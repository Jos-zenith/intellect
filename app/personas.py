PERSONAS = {
    "qa_strategist": {
        "name": "QA Strategist",
        "system_prompt": "You are a QA Strategist. Use Socratic dialogue: ask one guiding question, then explain. Use only provided context.",
    },
    "test_designer": {
        "name": "Test Designer",
        "system_prompt": "You are a Test Designer. Build robust test cases and explain edge cases in a coaching style. Use only provided context.",
    },
    "debug_coach": {
        "name": "Debug Coach",
        "system_prompt": "You are a Debug Coach. Lead the learner with root-cause questioning and practical fixes. Use only provided context.",
    },
    "automation_architect": {
        "name": "Automation Architect",
        "system_prompt": "You are an Automation Architect. Explain framework and pipeline decisions with tradeoffs. Use only provided context.",
    },
    "performance_analyst": {
        "name": "Performance Analyst",
        "system_prompt": "You are a Performance Analyst. Focus on load, scalability, bottlenecks, and measurement. Use only provided context.",
    },
    "examiner": {
        "name": "Examiner",
        "system_prompt": "You are an Examiner. Explain concepts with exam-focused precision and scoring hints. Use only provided context.",
    },
}


ACADEMIC_SUCCESS_AGENTS = {
    "agent_a": {
        "name": "Agent A (Top Performers)",
        "focus": "Score Optimization",
        "strategy": "Use Chain-of-Thought style decomposition to surface subtle high-weightage gaps.",
    },
    "agent_b": {
        "name": "Agent B (Concept Clear)",
        "focus": "Rubric Issues",
        "strategy": "Output a structured JSON loss run against the marking scheme.",
    },
    "agent_c": {
        "name": "Agent C (Rote Learners)",
        "focus": "Application Weak",
        "strategy": "Use Variation Theory and generate what-if transfer scenarios.",
    },
    "agent_d": {
        "name": "Agent D (Weak Basics)",
        "focus": "Foundation Issues",
        "strategy": "Run a Socratic first-principles loop from fundamentals to applications.",
    },
    "agent_e": {
        "name": "Agent E (Inconsistent)",
        "focus": "Execution Problems",
        "strategy": "Track drift between classroom emphasis and practice patterns.",
    },
    "agent_f": {
        "name": "Agent F (Last-Minute)",
        "focus": "Time-Constrained",
        "strategy": "Apply 80/20 filtering over highest weightage chunks only.",
    },
}


def route_persona(question: str) -> tuple[str, str]:
    q = question.lower()
    rules = [
        ("performance", "performance_analyst"),
        ("load", "performance_analyst"),
        ("automation", "automation_architect"),
        ("pipeline", "automation_architect"),
        ("debug", "debug_coach"),
        ("error", "debug_coach"),
        ("test case", "test_designer"),
        ("scenario", "test_designer"),
        ("mock", "examiner"),
        ("exam", "examiner"),
    ]

    for token, persona_id in rules:
        if token in q:
            return persona_id, "rule-based"

    return "qa_strategist", "rule-based-default"


def route_success_agent(profile: dict) -> tuple[str, str]:
    marks = [float(m) for m in (profile.get("marks") or []) if isinstance(m, (int, float))]
    avg = sum(marks) / len(marks) if marks else 0.0

    feedback = str(profile.get("feedback") or "").lower()
    habits = str(profile.get("study_habits") or "").lower()
    prep_days = profile.get("days_until_exam")
    if prep_days is None:
        prep_days = profile.get("preparation_window_days")

    if prep_days is not None and int(prep_days) <= 2:
        return "agent_f", "override-urgency-exam-in-2-days"

    if avg >= 85 and "rubric" not in feedback and "presentation" not in feedback and "steps missing" not in feedback:
        return "agent_a", "rule-high-score-no-rubric-flags"

    if "rubric" in feedback or "steps missing" in feedback or "presentation" in feedback:
        return "agent_b", "rule-rubric-or-presentation-signal"

    if "memorise" in habits or "memorize" in habits or "rote" in habits or "formula" in habits:
        return "agent_c", "rule-rote-or-formula-pattern"

    if avg < 45 or "basic" in feedback:
        return "agent_d", "rule-low-score-or-basic-feedback"

    if "inconsistent" in feedback or "inconsistent" in habits or "irregular" in habits:
        return "agent_e", "rule-inconsistency-pattern"

    if avg < 60:
        return "agent_d", "rule-support-foundation-by-score"

    return "agent_e", "rule-default-calibration"
