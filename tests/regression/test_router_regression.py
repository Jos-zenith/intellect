from app.routing_policy import evaluate_routing_policy


def test_router_regression_keywords_and_exam_window() -> None:
    cases = [
        ({"feedback": "rubric keywords missing", "marks": [75, 78], "days_until_exam": 12}, "agent_b"),
        ({"feedback": "concept unclear and weak basics", "marks": [35, 41], "days_until_exam": 7}, "agent_d"),
        ({"study_habits": "rote memorize formulas", "marks": [62, 64], "days_until_exam": 8}, "agent_c"),
        ({"feedback": "inconsistent performance", "attendance_ratio": 0.5, "marks": [68, 66], "days_until_exam": 9}, "agent_e"),
        ({"feedback": "okay", "marks": [81, 79], "days_until_exam": 1}, "agent_f"),
    ]

    for profile, expected in cases:
        decision = evaluate_routing_policy(profile)
        assert decision.agent_id == expected
