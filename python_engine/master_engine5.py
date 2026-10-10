"""Master Engine 5: regime-adaptive coordinator for the four specialist engines.

This is an isolated, signal-only orchestration layer. It does not execute orders,
change the existing chart, or connect itself to production. It delegates base
indicator calculations to regime_adaptive_engine, adds explicit OHLC price-structure
context, adapts specialist weights by regime and structural confirmation, and returns
auditable diagnostics. Confidence is a directional confluence score, not win probability.
"""
from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any, Dict, List, Optional, Sequence

try:
    from .regime_adaptive_engine import evaluate as evaluate_base
except ImportError:  # direct execution from python_engine directory
    from regime_adaptive_engine import evaluate as evaluate_base

ENGINE_VERSION = "rizvi-master-engine-5.0.0"
TIMEFRAME_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600}
BASE_WEIGHTS = {
    "engine_1_trend": 0.28,
    "engine_2_momentum": 0.22,
    "engine_3_structure": 0.22,
    "engine_4_volatility": 0.28,
}
MIN_SUPPORTING_ENGINES = 3
WAIT_SCORE = 0.70
STRONG_SCORE = 0.80


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def _timestamp_seconds(value: Any) -> Optional[float]:
    if _finite(value):
        v = float(value)
        # Accept epoch seconds or milliseconds.
        return v / 1000.0 if v > 100_000_000_000 else v
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except ValueError:
            return None
    return None


def _structure(bars: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Compact swing/break context from closed OHLC bars; no order-book claims."""
    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"]) for b in bars]
    lows = [float(b["low"]) for b in bars]
    last = bars[-1]
    # Use prior bars only for reference levels, avoiding the current bar defining its own break.
    lookback = min(20, len(bars) - 1)
    prior_high = max(highs[-lookback-1:-1])
    prior_low = min(lows[-lookback-1:-1])
    close = closes[-1]
    ranges = [max(1e-12, highs[i] - lows[i]) for i in range(max(0, len(bars)-14), len(bars))]
    avg_range = sum(ranges) / len(ranges)
    tolerance = max(avg_range * 0.08, abs(close) * 1e-8)
    if close > prior_high + tolerance:
        breakout = 1.0
        label = "BULLISH_BREAKOUT"
    elif close < prior_low - tolerance:
        breakout = -1.0
        label = "BEARISH_BREAKDOWN"
    else:
        breakout = 0.0
        label = "INSIDE_RANGE"

    # Recent swing progression; compare two separated windows rather than one candle.
    span = min(8, max(3, (len(bars)-1)//3))
    old_high = max(highs[-2*span-1:-span-1])
    new_high = max(highs[-span-1:-1])
    old_low = min(lows[-2*span-1:-span-1])
    new_low = min(lows[-span-1:-1])
    up_structure = new_high > old_high and new_low > old_low
    down_structure = new_high < old_high and new_low < old_low
    swing = 1.0 if up_structure else -1.0 if down_structure else 0.0

    # Candle close location is a small confirmation only, not an independent signal.
    spread = max(1e-12, float(last["high"]) - float(last["low"]))
    close_location = max(-1.0, min(1.0, 2.0 * (close - float(last["low"])) / spread - 1.0))
    score = max(-1.0, min(1.0, 0.55 * breakout + 0.35 * swing + 0.10 * close_location))
    return {
        "score": round(score, 4),
        "breakout": label,
        "swing_structure": "BULLISH" if up_structure else "BEARISH" if down_structure else "MIXED",
        "prior_range_high": prior_high,
        "prior_range_low": prior_low,
        "close_location": round(close_location, 4),
    }


def _adaptive_weights(regime: str, structure_score: float, base_engines: Dict[str, Any]) -> Dict[str, float]:
    weights = dict(BASE_WEIGHTS)
    if regime == "TRENDING":
        weights["engine_1_trend"] += 0.10
        weights["engine_2_momentum"] += 0.03
        weights["engine_4_volatility"] -= 0.08
        weights["engine_3_structure"] -= 0.05
    elif regime == "RANGING":
        weights["engine_2_momentum"] += 0.08
        weights["engine_4_volatility"] += 0.06
        weights["engine_1_trend"] -= 0.08
        weights["engine_3_structure"] -= 0.06
    elif regime == "HIGH_VOLATILITY":
        weights["engine_4_volatility_price_action"] += 0.10
        weights["engine_3_volume"] += 0.04
        weights["engine_1_trend"] -= 0.07
        weights["engine_2_momentum"] -= 0.07
    elif regime == "LOW_VOLATILITY":
        weights["engine_4_volatility_price_action"] += 0.05
        weights["engine_2_momentum"] += 0.04
        weights["engine_1_trend"] -= 0.04
        weights["engine_3_volume"] -= 0.05

    # Structural evidence modifies weight only modestly; it never overrides feed/consensus gates.
    weights["engine_4_volatility_price_action"] += 0.04 * abs(structure_score)
    # Missing specialist scores get no invented vote and are removed before normalization.
    active = {k: max(0.05, v) for k, v in weights.items() if base_engines.get(k, {}).get("score") is not None}
    total = sum(active.values())
    return {k: round(v / total, 6) for k, v in active.items()} if total else {}


def evaluate(raw_bars: Sequence[Dict[str, Any]], symbol: str = "XAUUSD", timeframe: str = "1m",
             order_flow: Optional[Dict[str, Any]] = None, now_seconds: Optional[float] = None) -> Dict[str, Any]:
    """Return final signal and complete engine/structure/weight diagnostics."""
    base = evaluate_base(raw_bars, symbol=symbol, timeframe=timeframe, order_flow=order_flow)
    if not base.get("ok"):
        return {**base, "engine_version": ENGINE_VERSION, "signal": "WAIT", "autoTrading": False}
    if timeframe not in TIMEFRAME_SECONDS:
        return {**base, "engine_version": ENGINE_VERSION, "signal": "WAIT", "reason": "Unsupported timeframe", "autoTrading": False}
    bars = list(raw_bars)
    now = now_seconds if _finite(now_seconds) else datetime.now(timezone.utc).timestamp()
    last_ts = _timestamp_seconds(bars[-1].get("timestamp")) if bars else None
    max_age = max(3 * TIMEFRAME_SECONDS[timeframe], 180)
    if last_ts is None:
        return {"ok": False, "engine_version": ENGINE_VERSION, "signal": "WAIT", "reason": "Invalid latest candle timestamp", "autoTrading": False}
    age = now - last_ts
    # Permit at most one timeframe of clock skew into the future.
    if age > max_age or age < -TIMEFRAME_SECONDS[timeframe]:
        return {"ok": False, "engine_version": ENGINE_VERSION, "symbol": symbol, "timeframe": timeframe,
                "signal": "WAIT", "reason": "Candle feed is stale or timestamp is in the future",
                "candle_age_seconds": round(age, 2), "autoTrading": False}

    structure = _structure(bars)
    engine_scores = {k: v.get("score") for k, v in base.get("engines", {}).items()}
    weights = _adaptive_weights(base.get("regime", "UNKNOWN"), structure["score"], base.get("engines", {}))
    usable = {k: float(v) for k, v in engine_scores.items() if v is not None and _finite(v) and k in weights}
    if len(usable) < MIN_SUPPORTING_ENGINES or base.get("regime") == "UNKNOWN":
        return {**base, "engine_version": ENGINE_VERSION, "structure": structure, "weights": weights,
                "signal": "WAIT", "confidence": None, "reason": "Insufficient valid engines or unknown market regime",
                "candle_age_seconds": round(age, 2), "autoTrading": False}

    # Specialist scores are directional votes in [-1, +1]. Structure is a bounded fifth
    # evidence stream but cannot satisfy the three-specialist consensus requirement.
    active_total = sum(weights[k] for k in usable)
    engine_score = sum(usable[k] * weights[k] for k in usable) / active_total
    structure_weight = 0.12
    combined = max(-1.0, min(1.0, (engine_score * (1 - structure_weight)) + structure["score"] * structure_weight))
    direction = "BUY" if combined > 0 else "SELL" if combined < 0 else "WAIT"
    supporting = sum(1 for v in usable.values() if (v > 0.15 if direction == "BUY" else v < -0.15 if direction == "SELL" else False))
    opposing = sum(1 for v in usable.values() if (v < -0.15 if direction == "BUY" else v > 0.15 if direction == "SELL" else False))
    confidence = round(abs(combined) * 100, 1)
    if confidence < WAIT_SCORE * 100 or supporting < MIN_SUPPORTING_ENGINES or opposing >= 2:
        signal = "WAIT"
        reason = "Consensus/score gate failed; requires >=70 score, 3 supporting engines, and no major conflict"
    elif confidence < STRONG_SCORE * 100:
        signal = "WEAK_BUY" if direction == "BUY" else "WEAK_SELL"
        reason = "Directional confluence 70-79; weak setup"
    else:
        signal = direction
        reason = "Strong directional confluence >=80 with at least 3 specialist engines agreeing"

    return {
        "ok": True, "engine_version": ENGINE_VERSION, "base_engine_version": base.get("version"),
        "symbol": symbol, "timeframe": timeframe, "regime": base.get("regime"),
        "indicators": base.get("indicators", {}), "engines": base.get("engines", {}),
        "structure": structure, "weights": weights,
        "master_engine": {"score": round(combined, 4), "confidence": confidence,
                          "supporting_engines": supporting, "opposing_engines": opposing,
                          "available_engines": len(usable), "signal": signal, "reason": reason},
        "signal": signal, "confidence": confidence, "reason": reason,
        "candle_age_seconds": round(age, 2), "order_flow_status": base.get("order_flow_status", "NOT_ATTACHED"),
        "autoTrading": False, "timestamp": datetime.now(timezone.utc).isoformat(),
    }
