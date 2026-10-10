"""Rizvi Dashboard V5 - Master Engine 5 adaptive score orchestrator.

This module combines four specialist-engine indicator votes into one explainable,
regime- and timeframe-adaptive signal-quality score. It is signal-only: no orders,
network calls, dashboard UI changes, or automatic trading.

Input indicator votes must be normalized to [-1, +1] (bearish to bullish).
The returned confidence is directional confluence, NOT a calibrated win probability.
"""
from __future__ import annotations

from math import isfinite
from typing import Any, Dict, Mapping, Optional

ENGINE_VERSION = "rizvi-master-engine-v5.0"
ENGINE_KEYS = ("trend", "momentum", "structure_liquidity", "volume_price_action")
TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h"}

# These are initial research priors, not learned/proven optimal weights.
REGIME_WEIGHTS = {
    "TRENDING": {"trend": .34, "momentum": .23, "structure_liquidity": .25, "volume_price_action": .18},
    "RANGING": {"trend": .16, "momentum": .25, "structure_liquidity": .34, "volume_price_action": .25},
    "HIGH_VOLATILITY": {"trend": .22, "momentum": .20, "structure_liquidity": .28, "volume_price_action": .30},
    "LOW_VOLATILITY": {"trend": .20, "momentum": .24, "structure_liquidity": .31, "volume_price_action": .25},
    "UNKNOWN": {"trend": .25, "momentum": .25, "structure_liquidity": .25, "volume_price_action": .25},
}
TIMEFRAME_MULTIPLIERS = {
    "1m": {"trend": .85, "momentum": 1.10, "structure_liquidity": 1.05, "volume_price_action": 1.00},
    "5m": {"trend": .95, "momentum": 1.05, "structure_liquidity": 1.05, "volume_price_action": .95},
    "15m": {"trend": 1.05, "momentum": 1.00, "structure_liquidity": 1.00, "volume_price_action": .95},
    "30m": {"trend": 1.10, "momentum": .95, "structure_liquidity": 1.00, "volume_price_action": .95},
    "1h": {"trend": 1.15, "momentum": .90, "structure_liquidity": 1.00, "volume_price_action": .95},
}
# Within-engine indicator defaults; callers may override per indicator via {score, weight}.
INDICATOR_WEIGHTS = {
    "trend": {"EMA": 1.2, "SMA": .8, "MACD": 1.0, "ADX": .8, "ICHIMOKU": .7, "EMA_SLOPE": .8},
    "momentum": {"RSI": 1.0, "STOCHASTIC": .7, "CCI": .6, "MFI": .7, "ROC": .8, "WILLIAMS_R": .5, "DIVERGENCE": 1.0},
    "structure_liquidity": {"MARKET_STRUCTURE": 1.3, "SUPPORT_RESISTANCE": 1.0, "LIQUIDITY_SWEEP": 1.0, "FVG": .7, "SESSION": .4},
    "volume_price_action": {"VWAP": 1.0, "VOLUME_PROFILE": .7, "OBV": .6, "CMF": .6, "CANDLE_PATTERN": .8, "PRICE_ACTION": 1.2, "ATR_CONTEXT": .4},
}
MIN_ACTIVE_ENGINES = 3
WEAK_THRESHOLD = 70.0
STRONG_THRESHOLD = 80.0


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def _clip(value: float) -> float:
    return max(-1.0, min(1.0, float(value)))


def _vote_value(value: Any) -> Optional[float]:
    if _finite(value):
        return _clip(float(value))
    if isinstance(value, Mapping):
        if value.get("available", True) is False:
            return None
        score = value.get("score")
        return _clip(float(score)) if _finite(score) else None
    return None


def _normalise(weights: Mapping[str, float], active: set[str]) -> Dict[str, float]:
    positive = {key: max(0.0, float(weights.get(key, 0.0))) for key in active}
    total = sum(positive.values())
    if total <= 0:
        return {key: 1.0 / len(active) for key in active} if active else {}
    return {key: value / total for key, value in positive.items()}


def _engine_score(engine: str, votes: Any, fallback_scores: Mapping[str, Any]) -> Dict[str, Any]:
    if isinstance(votes, Mapping):
        rows = []
        for name, raw in votes.items():
            value = _vote_value(raw)
            if value is None:
                continue
            custom_weight = raw.get("weight") if isinstance(raw, Mapping) else None
            default_weight = INDICATOR_WEIGHTS[engine].get(str(name).upper(), 1.0)
            weight = float(custom_weight) if _finite(custom_weight) and float(custom_weight) > 0 else default_weight
            rows.append((str(name), value, weight))
        if rows:
            total = sum(row[2] for row in rows)
            score = sum(value * weight for _, value, weight in rows) / total
            return {
                "score": _clip(score),
                "indicator_count": len(rows),
                "indicators_used": [name for name, _, _ in rows],
                "indicator_contributions": {
                    name: round(value * weight / total, 4) for name, value, weight in rows
                },
                "source": "indicator_votes",
            }
    fallback = fallback_scores.get(engine)
    if isinstance(fallback, Mapping):
        fallback = fallback.get("score")
    if _finite(fallback):
        return {"score": _clip(float(fallback)), "indicator_count": 0,
                "indicators_used": [], "indicator_contributions": {},
                "source": "specialist_engine_score"}
    return {"score": None, "indicator_count": 0, "indicators_used": [],
            "indicator_contributions": {}, "source": "unavailable"}


def evaluate_master(
    indicator_votes: Mapping[str, Any],
    *,
    regime: str,
    timeframe: str,
    structure_score: Optional[float] = None,
    price_action_score: Optional[float] = None,
    specialist_scores: Optional[Mapping[str, Any]] = None,
    data_fresh: bool = True,
    data_valid: bool = True,
    symbol: str = "XAUUSD",
) -> Dict[str, Any]:
    """Combine four specialist groups. Missing/stale data fails closed to WAIT.

    indicator_votes example:
      {
        "trend": {"EMA": 1, "MACD": 0.7},
        "momentum": {"RSI": 0.4, "DIVERGENCE": -0.5},
        "structure_liquidity": {"MARKET_STRUCTURE": 1, "FVG": 0.5},
        "volume_price_action": {"VWAP": 1, "CANDLE_PATTERN": 0.6}
      }
    Scores are directional votes in [-1, +1], not raw indicator values.
    """
    regime = str(regime).upper()
    timeframe = str(timeframe)
    if timeframe not in TIMEFRAMES:
        return {"ok": False, "version": ENGINE_VERSION, "symbol": symbol,
                "timeframe": timeframe, "signal": "WAIT",
                "reason": "Unsupported timeframe", "autoTrading": False}
    if not data_fresh or not data_valid:
        return {"ok": False, "version": ENGINE_VERSION, "symbol": symbol,
                "timeframe": timeframe, "signal": "WAIT",
                "reason": "Market data is stale or failed validation; fail-closed",
                "autoTrading": False}
    if not isinstance(indicator_votes, Mapping):
        indicator_votes = {}
    fallbacks = specialist_scores if isinstance(specialist_scores, Mapping) else {}
    engines = {
        key: _engine_score(key, indicator_votes.get(key), fallbacks)
        for key in ENGINE_KEYS
    }
    active = {key for key, item in engines.items() if item["score"] is not None}
    if len(active) < MIN_ACTIVE_ENGINES:
        return {
            "ok": True, "version": ENGINE_VERSION, "symbol": symbol,
            "timeframe": timeframe, "regime": regime, "engines": engines,
            "signal": "WAIT", "score": None, "confidence": None,
            "reason": "At least three valid specialist engines are required",
            "autoTrading": False,
        }

    base = REGIME_WEIGHTS.get(regime, REGIME_WEIGHTS["UNKNOWN"])
    multipliers = TIMEFRAME_MULTIPLIERS[timeframe]
    adjusted = {key: base[key] * multipliers[key] for key in active}
    # Context scores are additional evidence, not a fifth specialist engine.
    # When supplied, they modestly tilt the related engine weight, capped to avoid domination.
    if _finite(structure_score) and "structure_liquidity" in active:
        adjusted["structure_liquidity"] *= 1.0 + 0.20 * _clip(float(structure_score))
    if _finite(price_action_score) and "volume_price_action" in active:
        adjusted["volume_price_action"] *= 1.0 + 0.15 * _clip(float(price_action_score))
    weights = _normalise(adjusted, active)
    raw_score = sum(float(engines[key]["score"]) * weights[key] for key in active)
    score = _clip(raw_score)
    direction = "BUY" if score > 0 else "SELL" if score < 0 else "WAIT"
    supporting = sum(
        1 for key in active
        if (float(engines[key]["score"]) >= 0.15 if direction == "BUY"
            else float(engines[key]["score"]) <= -0.15 if direction == "SELL" else False)
    )
    confidence = round(abs(score) * 100.0, 1)
    conflicts = [key for key in active if direction != "WAIT" and
                 float(engines[key]["score"]) * (1 if direction == "BUY" else -1) < -0.25]
    if direction == "WAIT" or confidence < WEAK_THRESHOLD or supporting < MIN_ACTIVE_ENGINES:
        signal = "WAIT"
        reason = "Consensus too weak or engines conflict; wait for alignment"
    elif confidence < STRONG_THRESHOLD:
        signal = "WEAK_BUY" if direction == "BUY" else "WEAK_SELL"
        reason = "70-79.9 directional confluence score; weak setup"
    else:
        signal = direction
        reason = "Strong confluence score with at least three supporting engines"
    if len(conflicts) >= 2:
        signal = "WAIT"
        reason = "Two or more specialist engines strongly oppose the majority"
    return {
        "ok": True, "version": ENGINE_VERSION, "symbol": symbol,
        "timeframe": timeframe, "regime": regime,
        "engines": engines,
        "weights": {key: round(value, 4) for key, value in weights.items()},
        "master_engine": {
            "score": round(score, 4), "confidence": confidence,
            "direction": direction, "signal": signal,
            "supporting_engines": supporting, "available_engines": len(active),
            "conflicting_engines": conflicts, "reason": reason,
            "score_type": "directional_confluence_not_win_probability",
        },
        "signal": signal, "confidence": confidence, "reason": reason,
        "autoTrading": False,
    }


def health() -> Dict[str, Any]:
    return {
        "ok": True, "engine": ENGINE_VERSION, "engines_managed": 4,
        "role": "master_weighting_and_confluence", "autoTrading": False,
        "mode": "signal_only", "timeframes": sorted(TIMEFRAMES),
        "score_range": [-1, 1], "confidence_is_win_probability": False,
    }
