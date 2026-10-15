"""Python-side engine orchestration experiment for Rizvi Dashboard V5.

Isolated from production. Settings below mirror the currently deployed Engine 5
qualification contract; do not tune them in this migration experiment.
This module deliberately reports unavailable external inputs as unavailable.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from engine_parity import evaluate as evaluate_algorithms, normalize_bars

LOCKED_ENGINE5 = {
    "required_aligned_algorithms": 4,
    "required_algorithms_evaluated": 5,
    "minimum_confidence": 80,
    "minimum_indicator_agreement": 70,
    "minimum_active_indicators": 6,
    "required_qualified_runs": 3,
    "maximum_snapshot_age_ms_floor": 180_000,
    "maximum_snapshot_age_timeframe_multiplier": 3_000,
    "auto_trading": False,
}

EXPECTED_INDICATORS = [
    "EMA 9/21", "RSI-14", "Trend (5)", "VWAP Filter",
    "Volatility Regime Filter", "ATR (14)", "Market Structure",
    "Structure Prediction", "Candle Patterns / Price Action",
    "Fair Value Gap (FVG)", "Support & Resistance", "Volume Profile",
    "Liquidity Pools / Sweeps", "Bullish/Bearish Divergence",
    "Trading Sessions", "Day High / Day Low",
    "DXY Inverse-Correlation Filter", "High-Impact US News Filter",
]


@dataclass
class EngineReport:
    engine: str
    status: str
    symbol: str
    timeframe: str
    bar_count: int
    input_snapshot_id: str | None
    action: str = "WAIT"
    score: float = 0
    agreement: float = 0
    active_indicators: int = 0
    unavailable_inputs: list[str] | None = None
    reasons: list[str] | None = None


def validate_snapshot(snapshot: dict[str, Any], now_ms: int) -> list[str]:
    """Validate one immutable snapshot before any engine evaluates it."""
    errors: list[str] = []
    symbol = str(snapshot.get("symbol", "")).upper().replace(" ", "")
    symbol = "XAU/USD" if symbol in {"XAUUSD", "XAU/USD", "GOLD"} else symbol
    if symbol != "XAU/USD":
        errors.append("symbol-not-XAU/USD")
    timeframe = str(snapshot.get("timeframe", "")).upper()
    if timeframe not in {"1M", "5M", "15M", "30M", "1H", "1D"}:
        errors.append("unsupported-timeframe")
    captured = snapshot.get("captured_at_ms")
    if not isinstance(captured, (int, float)) or captured <= 0:
        errors.append("snapshot-timestamp-missing")
    else:
        floor = LOCKED_ENGINE5["maximum_snapshot_age_ms_floor"]
        multiplier = LOCKED_ENGINE5["maximum_snapshot_age_timeframe_multiplier"]
        tf_ms = {"1M": 60_000, "5M": 300_000, "15M": 900_000,
                 "30M": 1_800_000, "1H": 3_600_000, "1D": 86_400_000}.get(timeframe, 60_000)
        max_age = max(floor, tf_ms * (multiplier / 1000))
        age = now_ms - captured
        if age < 0:
            errors.append("snapshot-timestamp-in-future")
        elif age > max_age:
            errors.append("snapshot-stale")
    rows = normalize_bars(snapshot.get("bars", []))
    if len(rows) < 21:
        errors.append("insufficient-valid-bars")
    if rows and isinstance(snapshot.get("bars"), list):
        last_stamp = rows[-1].get("time", float("nan"))
        if last_stamp != last_stamp:
            errors.append("latest-bar-timestamp-invalid")
    return errors


def _engine_report(name: str, snapshot: dict[str, Any], status: str,
                   unavailable: list[str], reasons: list[str], action: str = "WAIT",
                   score: float = 0, agreement: float = 0, active: int = 0) -> EngineReport:
    return EngineReport(
        engine=name, status=status, symbol=str(snapshot.get("symbol", "XAU/USD")),
        timeframe=str(snapshot.get("timeframe", "1M")),
        bar_count=len(normalize_bars(snapshot.get("bars", []))),
        input_snapshot_id=snapshot.get("snapshot_id"), action=action, score=score,
        agreement=agreement, active_indicators=active,
        unavailable_inputs=unavailable, reasons=reasons,
    )


def evaluate_engine_system(snapshot: dict[str, Any], now_ms: int,
                           indicators: dict[str, dict[str, Any]] | None = None,
                           context: dict[str, Any] | None = None,
                           prior_qualified_runs: int = 0) -> dict[str, Any]:
    """Evaluate four reporting engines + five scorers + locked Master Engine 5 gates.

    Engines 1-4 are transparent partitions of the current 18-indicator contract.
    External inputs (DXY, news, session/day range, order flow) must be explicitly
    passed as live context; missing inputs are never synthesized.
    """
    indicators = indicators or {}
    context = context or {}
    bars = normalize_bars(snapshot.get("bars", []))
    snapshot_errors = validate_snapshot(snapshot, now_ms)
    symbol = str(snapshot.get("symbol", "XAU/USD"))
    timeframe = str(snapshot.get("timeframe", "1M"))
    snap_id = snapshot.get("snapshot_id")
    groups = {
        "ENGINE_1_TREND_MOMENTUM": EXPECTED_INDICATORS[:6],
        "ENGINE_2_STRUCTURE_PRICE_ACTION": EXPECTED_INDICATORS[6:11],
        "ENGINE_3_VOLUME_LIQUIDITY": EXPECTED_INDICATORS[11:13],
        "ENGINE_4_DIVERGENCE_MARKET_CONTEXT": EXPECTED_INDICATORS[13:18],
    }
    engine_reports = {}
    for name, keys in groups.items():
        supplied = {key: indicators[key] for key in keys if key in indicators}
        unavailable = [key for key in keys if key not in supplied or
                       str(supplied[key].get("status", "")).upper() not in {"LIVE", "CALCULATED"}]
        indicator_reasons = {}
        for key in keys:
            item = supplied.get(key)
            if item is None:
                indicator_reasons[key] = ["missing"]
                continue
            status = str(item.get("status", "")).upper()
            item_reasons = []
            if status not in {"LIVE", "CALCULATED"}:
                item_reasons.append(f"status-{status.lower() or 'missing'}")
            score = item.get("score")
            if not isinstance(score, (int, float)) or not __import__("math").isfinite(float(score)):
                item_reasons.append("score-invalid")
            elif float(score) <= 0:
                item_reasons.append("score-not-active")
            bias = item.get("bias")
            if not isinstance(bias, (int, float)) or int(bias) not in {-1, 0, 1}:
                item_reasons.append("bias-invalid")
            if item_reasons:
                indicator_reasons[key] = item_reasons
        active = [v for v in supplied.values()
                  if str(v.get("status", "")).upper() in {"LIVE", "CALCULATED"}
                  and isinstance(v.get("score"), (int, float))
                  and __import__("math").isfinite(float(v["score"]))
                  and float(v["score"]) > 0
                  and isinstance(v.get("bias"), (int, float))
                  and int(v["bias"]) in {-1, 0, 1}]
        bias_sum = sum(int(v["bias"]) for v in active)
        action = "BUY" if bias_sum > 0 else "SELL" if bias_sum < 0 else "WAIT"
        score = sum(float(v["score"]) for v in active) / len(active) if active else 0
        engine_reports[name] = asdict(_engine_report(
            name, snapshot, "AVAILABLE" if supplied and not unavailable else "PARTIAL" if supplied else "UNAVAILABLE",
            unavailable, (["missing-or-invalid-snapshot"] if snapshot_errors else []),
            action, score, (len(active) / len(keys) * 100), len(active),
        ))
        engine_reports[name]["indicator_reasons"] = indicator_reasons

    algo_report = evaluate_algorithms(bars)
    algo_rows = list(algo_report["algorithms"].values())
    buy = sum(row["action"] == "BUY" for row in algo_rows)
    sell = sum(row["action"] == "SELL" for row in algo_rows)
    wait_count = sum(row["action"] == "WAIT" for row in algo_rows)
    majority = "BUY" if buy > sell else "SELL" if sell > buy else "WAIT"

    active_indicator_rows = [
        (key, value) for key, value in indicators.items()
        if key in EXPECTED_INDICATORS
        and str(value.get("status", "")).upper() in {"LIVE", "CALCULATED"}
        and isinstance(value.get("score"), (int, float)) and float(value["score"]) > 0
    ]
    indicator_action = "WAIT"
    indicator_score = 0
    indicator_agreement = 0
    if active_indicator_rows:
        bias_sum = sum(int(v.get("bias", 0)) for _, v in active_indicator_rows
                       if isinstance(v.get("bias", 0), (int, float)))
        indicator_action = "BUY" if bias_sum > 0 else "SELL" if bias_sum < 0 else "WAIT"
        indicator_score = sum(float(v["score"]) for _, v in active_indicator_rows) / len(active_indicator_rows)
        directional = [int(v["bias"]) for _, v in active_indicator_rows
                       if isinstance(v.get("bias"), (int, float)) and int(v["bias"]) in {-1, 1}]
        indicator_agreement = round(100 * sum(b == (1 if indicator_action == "BUY" else -1) for b in directional) / len(directional)) if directional and indicator_action != "WAIT" else 0

    aligned = sum(row["action"] == indicator_action for row in algo_rows) if indicator_action != "WAIT" else 0
    confidence = round((indicator_score + (sum(r["confidence"] for r in algo_rows) / len(algo_rows) if algo_rows else 0)) / 2)
    reasons = list(snapshot_errors)
    if indicator_action == "WAIT": reasons.append("indicator-WAIT")
    if majority != indicator_action: reasons.append("majority-mismatch")
    if aligned < LOCKED_ENGINE5["required_aligned_algorithms"]: reasons.append("aligned<4")
    if len(algo_rows) < LOCKED_ENGINE5["required_algorithms_evaluated"]: reasons.append("algorithms<5")
    if confidence < LOCKED_ENGINE5["minimum_confidence"]: reasons.append("confidence<80")
    if indicator_agreement < LOCKED_ENGINE5["minimum_indicator_agreement"]: reasons.append("agreement<70")
    if len(active_indicator_rows) < LOCKED_ENGINE5["minimum_active_indicators"]: reasons.append("active-indicators<6")
    # Only the external blockers present in deployed Engine 5 are mandatory here.
    # Session/day-high-low are indicators; order flow/delta are not deployed gates.
    unavailable_context = [
        key for key in ("dxy", "us_news")
        if not isinstance(context.get(key), dict)
        or str(context[key].get("status", "")).upper() != "LIVE"
    ]
    # Missing context is reported separately; only a confirmed deployed blocker
    # blocks qualification. Do not treat unavailable as a synthetic conflict.
    if context.get("news_blocked") is True: reasons.append("news-block")
    if context.get("dxy_conflict") is True: reasons.append("DXY-block")
    candidate = not reasons
    required_runs = LOCKED_ENGINE5["required_qualified_runs"]
    qualified = candidate and prior_qualified_runs + 1 >= required_runs
    master_action = indicator_action if qualified else "WAIT"
    return {
        "experiment": True, "production_ready": False, "auto_trading": False,
        "snapshot": {"snapshot_id": snap_id, "symbol": symbol, "timeframe": timeframe,
                     "bar_count": len(bars), "captured_at_ms": snapshot.get("captured_at_ms"),
                     "errors": snapshot_errors},
        "engines": engine_reports,
        "indicators": {key: {"status": value.get("status", "MISSING"),
                             "score": value.get("score"), "bias": value.get("bias")}
                       for key, value in indicators.items()},
        "algorithms": algo_report,
        "master_engine_5": {
            "action": master_action, "candidate_action": indicator_action,
            "confidence": confidence, "indicator_agreement": indicator_agreement,
            "algorithm_majority": majority, "algorithm_votes": {"buy": buy, "sell": sell, "wait": wait_count},
            "algorithms_evaluated": len(algo_rows), "algorithms_aligned": aligned,
            "active_indicators": len(active_indicator_rows),
            "qualified_candidate": candidate, "qualified_runs": prior_qualified_runs + 1 if candidate else 0,
            "required_qualified_runs": required_runs, "qualified": qualified,
            "blockers": reasons, "unavailable_context": unavailable_context,
            "locked_settings": dict(LOCKED_ENGINE5),
        },
    }
