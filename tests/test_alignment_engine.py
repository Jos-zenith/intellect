import app.alignment_engine as alignment_engine
from app.alignment_engine import compare_taught_vs_syllabus, compute_emphasis_weights, parse_syllabus_text


def test_parse_syllabus_text_fallback(monkeypatch) -> None:
    monkeypatch.setattr(alignment_engine, "complete_text", lambda *args, **kwargs: "not-json")

    parsed = parse_syllabus_text(
        "- Signal Processing\n- Students will apply DFT\n- Fourier Transform",
        max_topics=5,
    )

    assert "Signal Processing" in parsed["topics"]
    assert any("Students will" in out for out in parsed["learning_outcomes"])


def test_compare_and_compute_weights() -> None:
    taught = [
        {"topic": "fourier transform", "frequency": 5, "lecture_time_minutes": 40.0},
        {"topic": "sampling theorem", "frequency": 3, "lecture_time_minutes": 24.0},
    ]
    syllabus = ["Fourier Transform", "Convolution"]
    comparison = compare_taught_vs_syllabus(taught, syllabus)

    assert "Fourier Transform" in comparison["covered_topics"]
    assert "Convolution" in comparison["missed_topics"]

    weights, boosts = compute_emphasis_weights(
        taught,
        syllabus,
        [{"topic": "fourier transform", "frequency": 4}],
    )

    assert weights["fourier transform"] >= 1.0
    assert "fourier transform" in boosts
