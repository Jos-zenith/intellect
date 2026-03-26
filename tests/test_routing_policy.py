from app.routing_policy import evaluate_routing_policy


def test_routing_policy_urgency_override() -> None:
    decision = evaluate_routing_policy(
        {
            "marks": [70, 68],
            "feedback": "Some rubric issues",
            "study_habits": "good",
            "days_until_exam": 2,
        }
    )

    assert decision.agent_id == "agent_f"
    assert decision.urgency_override is True
    assert decision.routed_by.startswith("policy-override")


def test_routing_policy_rubric_signal_prefers_agent_b() -> None:
    decision = evaluate_routing_policy(
        {
            "marks": [78, 80],
            "feedback": "Keywords missing against marking scheme and presentation issues",
            "study_habits": "regular",
            "days_until_exam": 10,
        }
    )

    assert decision.urgency_override is False
    assert decision.scorecard["agent_b"] >= 8.0


def test_routing_policy_default_calibration() -> None:
    decision = evaluate_routing_policy({"marks": [], "feedback": "", "study_habits": ""})

    assert decision.agent_id == "agent_d"
    assert decision.scorecard["agent_d"] > 0.0
