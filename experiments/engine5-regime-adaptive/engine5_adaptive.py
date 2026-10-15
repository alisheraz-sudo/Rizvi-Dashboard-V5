"""Isolated Engine 5 adaptive prototype. Not wired to production."""
from __future__ import annotations
from math import isfinite

BASE = {"trend": .22, "momentum": .18, "rsi": .12, "vwap": .12,
        "candle": .10, "liquidity": .12, "divergence": .08, "volume_profile": .06}
REGIME_BIASES = {
    "TRENDING_UP": {"trend": 1.45, "momentum": 1.35, "vwap": 1.15, "divergence": .70},
    "TRENDING_DOWN": {"trend": 1.45, "momentum": 1.35, "vwap": 1.15, "divergence": .70},
    "RANGING": {"rsi": 1.40, "divergence": 1.30, "liquidity": 1.20, "trend": .70, "momentum": .75},
    "HIGH_VOLATILITY": {"liquidity": 1.30, "candle": 1.20, "momentum": .90, "rsi": .85},
    "MIXED": {},
}
def score_engine5(features: dict, regime: str, regime_confidence: float = 0.5) -> dict:
    """features: feature -> signed score [-1,1], missing/None means unavailable."""
    regime = regime if regime in REGIME_BIASES else "MIXED"
    rc = max(0.0, min(1.0, float(regime_confidence)))
    bias = REGIME_BIASES[regime]
    weighted, total_weight, active, signs = 0.0, 0.0, [], []
    used = {}
    for name, base in BASE.items():
        raw = features.get(name)
        if raw is None:
            continue
        try: value = float(raw)
        except (TypeError, ValueError): continue
        if not isfinite(value): continue
        value = max(-1.0, min(1.0, value))
        # Fade regime-specific adjustments when regime classification is uncertain.
        multiplier = 1.0 + (bias.get(name, 1.0) - 1.0) * rc
        weight = base * multiplier
        weighted += value * weight
        total_weight += weight
        active.append(name)
        signs.append(1 if value > .05 else -1 if value < -.05 else 0)
        used[name] = round(weight, 5)
    if not active or total_weight <= 0:
        return {"action":"WAIT","confidence":0,"score":0,"regime":regime,
                "regime_confidence":rc,"active_features":active,"weights":used,
                "reason":"NO_VALID_FEATURES"}
    score = weighted / total_weight
    nonzero = [s for s in signs if s]
    agreement = abs(sum(nonzero)) / len(nonzero) if nonzero else 0.0
    # Confidence is a bounded decision-strength score, not a win probability.
    confidence = round(100 * abs(score) * (0.65 + 0.35 * agreement) * (0.75 + 0.25 * rc))
    action = "BUY" if score > 0 else "SELL" if score < 0 else "WAIT"
    if confidence < 55 or len(active) < 3 or agreement < .25:
        action = "WAIT"
    return {"action":action,"confidence":min(100,confidence),"score":round(score,5),
            "agreement":round(agreement,4),"regime":regime,"regime_confidence":rc,
            "active_features":active,"weights":used,"reason":"OK" if action!="WAIT" else "QUALITY_GATE"}
