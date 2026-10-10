"""Rizvi Dashboard V5: isolated, signal-only regime-adaptive engine.

No network calls, no order execution, no UI dependencies. Feed normalized OHLCV bars
(newest last) from the existing dashboard/backend. Missing required data returns WAIT.
Standard-library only so it can be tested before any deployment integration.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional, Sequence
from datetime import datetime, timezone


ENGINE_VERSION = "rizvi-regime-adaptive-v1.0"
MIN_BARS = 60
BUY_THRESHOLD = 0.80
WEAK_THRESHOLD = 0.70
MAX_ENGINE_WEIGHT = 0.35


@dataclass(frozen=True)
class Bar:
    timestamp: Any
    open: float
    high: float
    low: float
    close: float
    volume: float


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and isfinite(float(v))


def _sma(xs: Sequence[float], n: int) -> Optional[float]:
    if len(xs) < n:
        return None
    return mean(xs[-n:])


def _ema_series(xs: Sequence[float], n: int) -> List[float]:
    if not xs:
        return []
    alpha = 2.0 / (n + 1.0)
    out = [float(xs[0])]
    for x in xs[1:]:
        out.append(out[-1] + alpha * (float(x) - out[-1]))
    return out


def _rsi(closes: Sequence[float], n: int = 14) -> Optional[float]:
    if len(closes) <= n:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(0.0, x) for x in changes]
    losses = [max(0.0, -x) for x in changes]
    avg_g, avg_l = mean(gains[:n]), mean(losses[:n])
    for g, l in zip(gains[n:], losses[n:]):
        avg_g = (avg_g * (n - 1) + g) / n
        avg_l = (avg_l * (n - 1) + l) / n
    if avg_l == 0:
        return 100.0 if avg_g > 0 else 50.0
    return 100.0 - (100.0 / (1.0 + avg_g / avg_l))


def _atr(bars: Sequence[Bar], n: int = 14) -> Optional[float]:
    if len(bars) <= n:
        return None
    tr = []
    for i, b in enumerate(bars):
        prev = bars[i - 1].close if i else b.close
        tr.append(max(b.high - b.low, abs(b.high - prev), abs(b.low - prev)))
    return mean(tr[-n:])


def _safe_div(a: float, b: float, default: float = 0.0) -> float:
    return a / b if abs(b) > 1e-12 else default


def _direction(value: Optional[float], deadband: float = 0.0) -> Optional[float]:
    if value is None or not isfinite(value):
        return None
    if value > deadband:
        return 1.0
    if value < -deadband:
        return -1.0
    return 0.0


def _vote(votes: Sequence[Optional[float]]) -> Optional[float]:
    valid = [max(-1.0, min(1.0, float(v))) for v in votes if v is not None]
    return mean(valid) if valid else None


def _normalise_bars(raw: Sequence[Dict[str, Any]]) -> List[Bar]:
    if not isinstance(raw, (list, tuple)):
        raise ValueError("bars must be a list")
    bars: List[Bar] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("each bar must be an object")
        vals = [item.get(k) for k in ("open", "high", "low", "close", "volume")]
        if not all(_num(v) for v in vals):
            raise ValueError("bar %d has missing or non-numeric OHLCV values" % i)
        o, h, l, c, vol = map(float, vals)
        if min(o, h, l, c) <= 0 or vol < 0 or h < max(o, c, l) or l > min(o, c, h):
            raise ValueError("bar %d has invalid OHLCV ranges" % i)
        bars.append(Bar(item.get("timestamp"), o, h, l, c, vol))
    if len(bars) < MIN_BARS:
        raise ValueError("at least %d OHLCV bars are required" % MIN_BARS)

    timestamps = [bar.timestamp for bar in bars]
    if any(ts is None for ts in timestamps):
        raise ValueError("every candle must include a timestamp")
    if all(_num(ts) for ts in timestamps):
        if any(float(timestamps[i]) <= float(timestamps[i - 1]) for i in range(1, len(timestamps))):
            raise ValueError("candle timestamps must be strictly increasing")
    elif all(isinstance(ts, str) for ts in timestamps):
        parsed = []
        for ts in timestamps:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                parsed.append(dt.timestamp())
            except ValueError as exc:
                raise ValueError("timestamps must be numeric or ISO-8601 strings") from exc
        if any(parsed[i] <= parsed[i - 1] for i in range(1, len(parsed))):
            raise ValueError("candle timestamps must be strictly increasing")
    else:
        raise ValueError("timestamps must use one consistent numeric or ISO-8601 format")
    return bars


def _indicator_values(bars: Sequence[Bar]) -> Dict[str, Optional[float]]:
    c = [b.close for b in bars]
    h = [b.high for b in bars]
    l = [b.low for b in bars]
    v = [b.volume for b in bars]
    e12, e26 = _ema_series(c, 12), _ema_series(c, 26)
    macd = e12[-1] - e26[-1]
    macd_signal = _ema_series([a - b for a, b in zip(e12, e26)], 9)[-1]
    rsi = _rsi(c)
    hh14, ll14 = max(h[-14:]), min(l[-14:])
    stoch_k_series = []
    for end in range(14, len(bars) + 1):
        win_h, win_l = max(h[end-14:end]), min(l[end-14:end])
        stoch_k_series.append(100.0 * _safe_div(c[end-1] - win_l, win_h - win_l, 0.5) if win_h != win_l else 50.0)
    stoch_k = stoch_k_series[-1]
    stoch_d = mean(stoch_k_series[-3:])
    sma20 = _sma(c, 20)
    sd20 = pstdev(c[-20:]) if len(c) >= 20 else None
    atr = _atr(bars)
    tp = [(b.high + b.low + b.close) / 3.0 for b in bars]
    vol_sum = sum(v[-20:])
    vwap = _safe_div(sum(tp[i] * v[i] for i in range(len(bars) - 20, len(bars))), vol_sum, c[-1])
    obv_series = [0.0]
    for i in range(1, len(bars)):
        obv_series.append(obv_series[-1] + (v[i] if c[i] > c[i-1] else -v[i] if c[i] < c[i-1] else 0.0))
    tp20 = tp[-20:]
    tp_sma = mean(tp20)
    mad = mean(abs(x - tp_sma) for x in tp20)
    cci = _safe_div(tp[-1] - tp_sma, 0.015 * mad, 0.0) if mad else 0.0
    pos_flow = neg_flow = 0.0
    for i in range(max(1, len(bars) - 14), len(bars)):
        flow = tp[i] * v[i]
        if tp[i] > tp[i-1]:
            pos_flow += flow
        elif tp[i] < tp[i-1]:
            neg_flow += flow
    mfi = 100.0 if neg_flow == 0 and pos_flow else (50.0 if neg_flow == pos_flow == 0 else 100.0 - 100.0 / (1.0 + _safe_div(pos_flow, neg_flow)))
    mfv = []
    for b in bars[-21:]:
        spread = b.high - b.low
        multiplier = ((b.close - b.low) - (b.high - b.close)) / spread if spread else 0.0
        mfv.append(multiplier * b.volume)
    cmf = _safe_div(sum(mfv), sum(b.volume for b in bars[-21:]), 0.0)
    roc = 100.0 * _safe_div(c[-1] - c[-13], c[-13]) if len(c) >= 13 else None
    willr = -100.0 * _safe_div(max(h[-14:]) - c[-1], max(h[-14:]) - min(l[-14:]), 0.5) if max(h[-14:]) != min(l[-14:]) else -50.0
    # Wilder-style directional movement and ADX approximation.
    plus_dm, minus_dm, tr_list = [], [], []
    for i, b in enumerate(bars):
        prev = bars[i-1] if i else b
        up, down = b.high - prev.high, prev.low - b.low
        plus_dm.append(up if up > down and up > 0 else 0.0)
        minus_dm.append(down if down > up and down > 0 else 0.0)
        tr_list.append(max(b.high - b.low, abs(b.high - prev.close), abs(b.low - prev.close)))
    tr14 = sum(tr_list[-14:])
    pdi = 100.0 * _safe_div(sum(plus_dm[-14:]), tr14)
    mdi = 100.0 * _safe_div(sum(minus_dm[-14:]), tr14)
    dx_values = []
    for end in range(max(14, len(bars)-14), len(bars)+1):
        if end > len(bars) or end < 14:
            continue
        tr_x = sum(tr_list[end-14:end])
        p = 100.0 * _safe_div(sum(plus_dm[end-14:end]), tr_x)
        m = 100.0 * _safe_div(sum(minus_dm[end-14:end]), tr_x)
        dx_values.append(100.0 * _safe_div(abs(p-m), p+m))
    adx = mean(dx_values) if dx_values else None
    # Ichimoku conversion/base lines (current cloud spans are lag-sensitive; use direction only).
    tenkan = (max(h[-9:]) + min(l[-9:])) / 2.0
    kijun = (max(h[-26:]) + min(l[-26:])) / 2.0
    # Volume profile proxy: close-location weighted volume, not a full tick-level profile.
    vp_bias = _safe_div(sum(((2*b.close-b.high-b.low) / (b.high-b.low) if b.high != b.low else 0.0) * b.volume for b in bars[-30:]), sum(v[-30:]), 0.0)
    last = bars[-1]
    candle_range = last.high - last.low
    body = last.close - last.open
    upper_wick = last.high - max(last.open, last.close)
    lower_wick = min(last.open, last.close) - last.low
    pattern = 1.0 if body > 0 and abs(body) >= candle_range * 0.6 else (-1.0 if body < 0 and abs(body) >= candle_range * 0.6 else (0.25 if lower_wick > abs(body) * 1.5 else (-0.25 if upper_wick > abs(body) * 1.5 else 0.0)))
    return {
        "EMA": e12[-1], "SMA": sma20, "MACD": macd, "MACD_SIGNAL": macd_signal,
        "RSI": rsi, "STOCHASTIC": stoch_k, "STOCHASTIC_D": stoch_d,
        "BOLLINGER_MID": sma20, "BOLLINGER_UPPER": sma20 + 2*sd20 if sma20 is not None and sd20 is not None else None,
        "BOLLINGER_LOWER": sma20 - 2*sd20 if sma20 is not None and sd20 is not None else None,
        "ATR": atr, "VWAP": vwap, "OBV": obv_series[-1], "CCI": cci, "MFI": mfi,
        "CMF": cmf, "ADX": adx, "DI_PLUS": pdi, "DI_MINUS": mdi, "ROC": roc,
        "WILLIAMS_R": willr, "ICHIMOKU_TENKAN": tenkan, "ICHIMOKU_KIJUN": kijun,
        "VOLUME_PROFILE_BIAS": vp_bias, "CANDLE_PATTERN": pattern,
        "LAST_CLOSE": c[-1], "ATR_PCT": 100.0 * _safe_div(atr, c[-1]) if atr is not None else None,
        "EMA_SLOPE": 100.0 * _safe_div(e12[-1] - e12[-6], c[-1]) if len(e12) >= 6 else None,
        "OBV_CHANGE": obv_series[-1] - obv_series[-6] if len(obv_series) >= 6 else None,
    }


def _compute_engines(x: Dict[str, Optional[float]]) -> Dict[str, Dict[str, Any]]:
    close = x["LAST_CLOSE"]
    def d(name: str, deadband: float = 0.0) -> Optional[float]:
        val = x.get(name)
        return _direction(val, deadband)
    # Each indicator contributes at most once to its own specialist engine.
    trend = _vote([
        (1.0 if close > x["EMA"] else -1.0 if close < x["EMA"] else 0.0) if x["EMA"] is not None and close is not None else None,
        (1.0 if close > x["SMA"] else -1.0 if close < x["SMA"] else 0.0) if x["SMA"] is not None and close is not None else None,
        (1.0 if x["MACD"] > x["MACD_SIGNAL"] else -1.0 if x["MACD"] < x["MACD_SIGNAL"] else 0.0) if x["MACD"] is not None and x["MACD_SIGNAL"] is not None else None,
        d("EMA_SLOPE", 0.00002),
        (1.0 if x["DI_PLUS"] > x["DI_MINUS"] else -1.0 if x["DI_PLUS"] < x["DI_MINUS"] else 0.0) if x["DI_PLUS"] is not None and x["DI_MINUS"] is not None else None,
        (1.0 if x["ICHIMOKU_TENKAN"] > x["ICHIMOKU_KIJUN"] else -1.0 if x["ICHIMOKU_TENKAN"] < x["ICHIMOKU_KIJUN"] else 0.0) if x["ICHIMOKU_TENKAN"] is not None and x["ICHIMOKU_KIJUN"] is not None else None,
    ])
    momentum = _vote([
        (1.0 if x["RSI"] > 55 else -1.0 if x["RSI"] < 45 else 0.0) if x["RSI"] is not None else None,
        (1.0 if x["STOCHASTIC"] > 60 else -1.0 if x["STOCHASTIC"] < 40 else 0.0) if x["STOCHASTIC"] is not None else None,
        (1.0 if x["CCI"] > 50 else -1.0 if x["CCI"] < -50 else 0.0) if x["CCI"] is not None else None,
        (1.0 if x["MFI"] > 55 else -1.0 if x["MFI"] < 45 else 0.0) if x["MFI"] is not None else None,
        d("ROC", 0.01),
        (1.0 if x["WILLIAMS_R"] > -40 else -1.0 if x["WILLIAMS_R"] < -60 else 0.0) if x["WILLIAMS_R"] is not None else None,
    ])
    volume = _vote([
        (1.0 if close > x["VWAP"] else -1.0 if close < x["VWAP"] else 0.0) if x["VWAP"] is not None else None,
        d("OBV_CHANGE", 1e-9),
        (1.0 if x["CMF"] > 0.05 else -1.0 if x["CMF"] < -0.05 else 0.0) if x["CMF"] is not None else None,
        d("VOLUME_PROFILE_BIAS", 0.05),
    ])
    price_action = _vote([
        x["CANDLE_PATTERN"],
        (1.0 if close > x["BOLLINGER_UPPER"] else -1.0 if close < x["BOLLINGER_LOWER"] else 0.0) if x["BOLLINGER_UPPER"] is not None and x["BOLLINGER_LOWER"] is not None else None,
    ])
    # Explicitly not available from OHLCV: real order-book depth and aggressor-side delta.
    return {
        "engine_1_trend": {"score": trend, "inputs": ["EMA", "SMA", "MACD", "DI+/DI-", "Ichimoku", "EMA slope"]},
        "engine_2_momentum": {"score": momentum, "inputs": ["RSI", "Stochastic", "CCI", "MFI", "ROC", "Williams %R"]},
        "engine_3_structure": {"score": volume, "inputs": ["VWAP", "OBV", "CMF", "Volume Profile proxy"], "order_flow": "NOT_ATTACHED", "delta": "NOT_AVAILABLE_FROM_OHLCV"},
        "engine_4_volatility": {"score": price_action, "inputs": ["Bollinger Bands", "ATR/ATR%", "ADX regime context", "Candle pattern"], "atr_pct": x["ATR_PCT"], "adx": x["ADX"]},
    }


def _regime(x: Dict[str, Optional[float]]) -> str:
    atr_pct = x.get("ATR_PCT")
    adx = x.get("ADX")
    slope = x.get("EMA_SLOPE")
    if atr_pct is None or adx is None or slope is None:
        return "UNKNOWN"
    if atr_pct >= 1.0:
        return "HIGH_VOLATILITY"
    if adx >= 25 and abs(slope) >= 0.0001:
        return "TRENDING"
    if atr_pct <= 0.12 and adx < 18:
        return "LOW_VOLATILITY"
    return "RANGING"


def _adaptive_weights(regime: str) -> Dict[str, float]:
    presets = {
        "TRENDING": {"engine_1_trend": .34, "engine_2_momentum": .24, "engine_3_structure": .20, "engine_4_volatility": .22},
        "RANGING": {"engine_1_trend": .18, "engine_2_momentum": .28, "engine_3_structure": .22, "engine_4_volatility": .32},
        "HIGH_VOLATILITY": {"engine_1_trend": .22, "engine_2_momentum": .20, "engine_3_structure": .23, "engine_4_volatility": .35},
        "LOW_VOLATILITY": {"engine_1_trend": .22, "engine_2_momentum": .25, "engine_3_structure": .23, "engine_4_volatility": .30},
        "UNKNOWN": {"engine_1_trend": .25, "engine_2_momentum": .25, "engine_3_structure": .25, "engine_4_volatility": .25},
    }
    weights = presets.get(regime, presets["UNKNOWN"]).copy()
    # Hard cap each group; normalize after capping.
    weights = {k: min(v, MAX_ENGINE_WEIGHT) for k, v in weights.items()}
    total = sum(weights.values())
    return {k: v / total for k, v in weights.items()}


def evaluate(raw_bars: Sequence[Dict[str, Any]], symbol: str = "BTCUSD", timeframe: str = "1m",
             order_flow: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Evaluate OHLCV bars and return JSON-serializable engine diagnostics and a signal."""
    supported_timeframes = {"1m", "5m", "15m", "30m", "1h"}
    if timeframe not in supported_timeframes:
        return {"ok": False, "version": ENGINE_VERSION, "symbol": symbol, "timeframe": timeframe,
                "signal": "WAIT", "reason": "Unsupported timeframe", "autoTrading": False}
    try:
        bars = _normalise_bars(raw_bars)
    except (ValueError, TypeError) as exc:
        return {"ok": False, "version": ENGINE_VERSION, "symbol": symbol, "timeframe": timeframe,
                "signal": "WAIT", "reason": str(exc), "autoTrading": False}
    x = _indicator_values(bars)
    engines = _compute_engines(x)
    regime = _regime(x)
    weights = _adaptive_weights(regime)
    usable = {k: v["score"] for k, v in engines.items() if v["score"] is not None}
    if len(usable) < 3 or regime == "UNKNOWN":
        return {"ok": True, "version": ENGINE_VERSION, "symbol": symbol, "timeframe": timeframe,
                "regime": regime, "engines": engines, "weights": weights, "indicators": x,
                "signal": "WAIT", "confidence": None,
                "reason": "Insufficient independent engine confirmation or regime data",
                "autoTrading": False, "timestamp": datetime.now(timezone.utc).isoformat()}
    # Renormalize over available groups only; do not invent votes for missing groups.
    active_total = sum(weights[k] for k in usable)
    score = sum(usable[k] * weights[k] for k in usable) / active_total if active_total else 0.0
    agreement = sum(1 for val in usable.values() if val > 0.15) if score > 0 else sum(1 for val in usable.values() if val < -0.15)
    direction = "BUY" if score > 0 else "SELL" if score < 0 else "WAIT"
    confidence = round(min(100.0, abs(score) * 100.0), 1)
    # Conservative consensus: at least 3 engines must support the chosen direction.
    supporting = sum(1 for val in usable.values() if (val > 0.15 if direction == "BUY" else val < -0.15 if direction == "SELL" else False))
    if confidence < WEAK_THRESHOLD * 100 or supporting < 3:
        signal = "WAIT"
        reason = "Consensus below threshold: requires >=70% directional score and 3 supporting engines"
    elif confidence < BUY_THRESHOLD * 100:
        signal = "WEAK_BUY" if direction == "BUY" else "WEAK_SELL"
        reason = "Directional score is 70-79%; weak setup only"
    else:
        signal = direction
        reason = "Strong setup: score >=80% and at least 3 engines agree"
    flow_status = "NOT_ATTACHED"
    if isinstance(order_flow, dict) and order_flow.get("status") == "LIVE":
        # Only label it live if caller supplies explicit validated side-volume values.
        if _num(order_flow.get("buy_volume")) and _num(order_flow.get("sell_volume")):
            flow_status = "LIVE_VALIDATED"
        else:
            flow_status = "INVALID_PAYLOAD"
    return {
        "ok": True, "version": ENGINE_VERSION, "symbol": symbol, "timeframe": timeframe,
        "regime": regime, "engines": engines, "weights": weights,
        "master_engine": {"score": round(score, 4), "confidence": confidence,
                          "supporting_engines": supporting, "available_engines": len(usable),
                          "signal": signal, "reason": reason},
        "signal": signal, "confidence": confidence, "reason": reason,
        "indicators": x, "order_flow_status": flow_status,
        "autoTrading": False, "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def health() -> Dict[str, Any]:
    return {"ok": True, "engine": ENGINE_VERSION, "engines": 5,
            "indicator_inventory": 18, "autoTrading": False,
            "mode": "signal_only", "requires_ohlcv_bars": MIN_BARS}


if __name__ == "__main__":
    import json
    print(json.dumps(health(), indent=2))
