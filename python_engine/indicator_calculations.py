"""Deterministic OHLCV-only diagnostics for the locked Rizvi V5 roster.

These are descriptive diagnostics, not calibrated trading signals. Values that require
external or synchronized feeds are explicitly unavailable. No probability of profit is
estimated and this module does not enable signal scoring.
"""
from datetime import datetime, timezone
from math import isfinite
from typing import Any, Dict, List, Optional, Sequence

try:
    from .indicator_registry import ROSTER_VERSION
except ImportError:  # Support direct execution from the python_engine directory.
    from indicator_registry import ROSTER_VERSION


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and isfinite(float(v))


def _ema(values: Sequence[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    alpha = 2.0 / (period + 1.0)
    value = float(values[0])
    for x in values[1:]:
        value += alpha * (float(x) - value)
    return value


def _rsi(values: Sequence[float], period: int = 14) -> Optional[float]:
    if len(values) <= period:
        return None
    diffs = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(0.0, x) for x in diffs]
    losses = [max(0.0, -x) for x in diffs]
    avg_gain, avg_loss = sum(gains[:period]) / period, sum(losses[:period]) / period
    for gain, loss in zip(gains[period:], losses[period:]):
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0 if avg_gain else 50.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def _atr(bars: Sequence[Dict[str, Any]], period: int = 14) -> Optional[float]:
    if len(bars) < period + 1:
        return None
    tr = []
    for i in range(1, len(bars)):
        prev_close = float(bars[i - 1]["close"])
        bar = bars[i]
        tr.append(max(float(bar["high"]) - float(bar["low"]),
                      abs(float(bar["high"]) - prev_close),
                      abs(float(bar["low"]) - prev_close)))
    return sum(tr[-period:]) / period if len(tr) >= period else None


def _stamp_seconds(value: Any) -> Optional[float]:
    if _finite(value):
        x = float(value)
        return x / 1000.0 if x > 100_000_000_000 else x
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            return None
    return None


def _item(value: Any, status: str = "CALCULATED", note: str = "") -> Dict[str, Any]:
    return {"value": value, "status": status, "note": note}


def calculate_roster(raw_bars: Sequence[Dict[str, Any]], symbol: str, timeframe: str,
                     *, dxy_bars: Optional[Sequence[Dict[str, Any]]] = None,
                     news_events: Optional[Sequence[Dict[str, Any]]] = None,
                     trade_flow: Optional[Dict[str, Any]] = None,
                     higher_timeframe_bars: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Calculate available roster diagnostics from normalized, newest-last OHLCV bars."""
    bars = list(raw_bars or [])
    if len(bars) < 30:
        return {
            "version": ROSTER_VERSION, "symbol": symbol, "timeframe": timeframe,
            "ready_for_signal": False,
            "reason": "At least 30 validated bars are required for diagnostic calculations.",
            "indicators": {},
        }
    for i, bar in enumerate(bars):
        if not isinstance(bar, dict):
            raise ValueError("bar %d must be an object" % i)
        if not all(_finite(bar.get(k)) for k in ("open", "high", "low", "close", "volume")):
            raise ValueError("bar %d has missing or non-numeric OHLCV" % i)
        if float(bar["low"]) > min(float(bar["open"]), float(bar["close"])) or float(bar["high"]) < max(float(bar["open"]), float(bar["close"])):
            raise ValueError("bar %d has invalid high/low bounds" % i)
        if float(bar["volume"]) < 0:
            raise ValueError("bar %d has negative volume" % i)

    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"]) for b in bars]
    lows = [float(b["low"]) for b in bars]
    volumes = [float(b["volume"]) for b in bars]
    last = bars[-1]
    close = closes[-1]
    e9, e21 = _ema(closes, 9), _ema(closes, 21)
    rsi = _rsi(closes)
    atr = _atr(bars)
    atr_pct = 100.0 * atr / close if atr is not None and close else None
    typical = [(float(b["high"]) + float(b["low"]) + float(b["close"])) / 3.0 for b in bars[-20:]]
    vols20 = volumes[-20:]
    vol_total = sum(vols20)
    vwap20 = sum(p * v for p, v in zip(typical, vols20)) / vol_total if vol_total else None

    # Three-candle fair-value-gap candidate on the latest completed three-bar window.
    fvg = None
    if len(bars) >= 3:
        a, c = bars[-3], bars[-1]
        if float(c["low"]) > float(a["high"]):
            fvg = {"type": "bullish", "lower": float(a["high"]), "upper": float(c["low"])}
        elif float(c["high"]) < float(a["low"]):
            fvg = {"type": "bearish", "lower": float(c["high"]), "upper": float(a["low"])}

    # Basic recent swing levels; descriptive levels, not guaranteed support/resistance.
    window = min(20, len(bars))
    resistance, support = max(highs[-window:]), min(lows[-window:])
    prior_high, prior_low = max(highs[-window-1:-1]), min(lows[-window-1:-1])
    sweep = "none"
    if highs[-1] > prior_high and close < prior_high:
        sweep = "buy-side liquidity sweep candidate"
    elif lows[-1] < prior_low and close > prior_low:
        sweep = "sell-side liquidity sweep candidate"

    body = close - float(last["open"])
    candle_range = float(last["high"]) - float(last["low"])
    upper_wick = float(last["high"]) - max(float(last["open"]), close)
    lower_wick = min(float(last["open"]), close) - float(last["low"])
    candle_pattern = "neutral"
    if candle_range > 0 and abs(body) >= 0.65 * candle_range:
        candle_pattern = "bullish strong-body candidate" if body > 0 else "bearish strong-body candidate"
    elif lower_wick > abs(body) * 1.8 and lower_wick > upper_wick:
        candle_pattern = "lower-wick rejection candidate"
    elif upper_wick > abs(body) * 1.8 and upper_wick > lower_wick:
        candle_pattern = "upper-wick rejection candidate"

    # Session and day boundaries use UTC explicitly; they are not exchange-local sessions.
    stamp = _stamp_seconds(last.get("timestamp"))
    if stamp is not None:
        day_key = datetime.fromtimestamp(stamp, timezone.utc).date()
        day_bars = [b for b in bars if _stamp_seconds(b.get("timestamp")) is not None
                    and datetime.fromtimestamp(_stamp_seconds(b.get("timestamp")), timezone.utc).date() == day_key]
        day_high = max(float(b["high"]) for b in day_bars) if day_bars else None
        day_low = min(float(b["low"]) for b in day_bars) if day_bars else None
        hour = datetime.fromtimestamp(stamp, timezone.utc).hour
        session = "Asia (UTC 00–07)" if 0 <= hour < 7 else "London (UTC 07–13)" if hour < 13 else "New York (UTC 13–21)" if hour < 21 else "Off-session (UTC 21–24)"
    else:
        day_high = day_low = None
        session = None

    # OHLCV volume-at-close-bin proxy only; never label this as exchange/tick-level profile.
    low30, high30 = min(lows[-30:]), max(highs[-30:])
    profile_bins = [0.0] * 12
    if high30 > low30:
        for b in bars[-30:]:
            idx = int((float(b["close"]) - low30) / (high30 - low30) * 12)
            profile_bins[min(11, max(0, idx))] += float(b["volume"])
        profile_idx = max(range(12), key=lambda i: profile_bins[i])
        volume_profile_proxy = {"highest_close_bin": profile_idx, "bin_low": low30 + (high30-low30)*profile_idx/12,
                                "bin_high": low30 + (high30-low30)*(profile_idx+1)/12}
    else:
        volume_profile_proxy = {"highest_close_bin": 0, "bin_low": low30, "bin_high": high30}

    # Basic divergence candidate requires local extrema and RSI history; never predicts outcomes.
    divergence = "unavailable: insufficient pivot/RSI history"
    if len(bars) >= 35 and rsi is not None:
        old_rsi = _rsi(closes[:-5])
        if old_rsi is not None:
            price_change = close - closes[-6]
            rsi_change = rsi - old_rsi
            if price_change > 0 and rsi_change < -3:
                divergence = "bearish divergence candidate"
            elif price_change < 0 and rsi_change > 3:
                divergence = "bullish divergence candidate"
            else:
                divergence = "no simple divergence detected"

    # Regime is descriptive: ATR as a percentage of price, with broad generic bands.
    if atr_pct is None:
        regime = None
    elif atr_pct >= 1.0:
        regime = "high volatility"
    elif atr_pct <= 0.12:
        regime = "low volatility"
    else:
        regime = "normal volatility"

    flow_valid = False
    flow_values = None
    if isinstance(trade_flow, dict) and trade_flow.get("status") == "LIVE":
        observed_at = _stamp_seconds(trade_flow.get("observed_at"))
        age_seconds = datetime.now(timezone.utc).timestamp() - observed_at if observed_at is not None else None
        buy_volume = trade_flow.get("buy_volume")
        sell_volume = trade_flow.get("sell_volume")
        source = str(trade_flow.get("source", "")).strip()
        if (source and age_seconds is not None and -30 <= age_seconds <= 120
                and _finite(buy_volume) and _finite(sell_volume)
                and float(buy_volume) >= 0 and float(sell_volume) >= 0
                and float(buy_volume) + float(sell_volume) > 0):
            total_flow = float(buy_volume) + float(sell_volume)
            flow_values = {
                "buy_volume": float(buy_volume),
                "sell_volume": float(sell_volume),
                "delta_volume": float(buy_volume) - float(sell_volume),
                "delta_percent": 100.0 * (float(buy_volume) - float(sell_volume)) / total_flow,
                "source": source,
                "instrument_note": str(trade_flow.get("instrument_note", "")),
                "observed_at": trade_flow.get("observed_at"),
                "trade_count": trade_flow.get("trade_count"),
            }
            flow_valid = True

    values = {
        "ema_9_21": _item({"ema9": e9, "ema21": e21, "bias": "bullish" if e9 is not None and e21 is not None and e9 > e21 else "bearish" if e9 is not None and e21 is not None and e9 < e21 else "neutral"}),
        "rsi_14": _item(rsi, "CALCULATED" if rsi is not None else "INSUFFICIENT_HISTORY"),
        "trend_5": _item(None, "UNAVAILABLE_MISSING_TIMEFRAME_CONTEXT", "Requires synchronized 5m/15m bars; no higher-timeframe bars were supplied.") if not higher_timeframe_bars else _item("requires dedicated multi-timeframe implementation", "PENDING_VALIDATION"),
        "vwap_filter": _item({"rolling_20_bar_vwap": vwap20, "bias": "above" if vwap20 is not None and close > vwap20 else "below" if vwap20 is not None and close < vwap20 else "at_or_unavailable"}, "PROXY_NOT_SESSION_VWAP", "Rolling 20-bar OHLCV proxy, not true exchange/session VWAP."),
        "volatility_regime": _item(regime, "CALCULATED" if regime else "INSUFFICIENT_HISTORY"),
        "atr_14": _item(atr, "CALCULATED" if atr is not None else "INSUFFICIENT_HISTORY"),
        "market_structure": _item({"recent_resistance": resistance, "recent_support": support, "close_vs_range": "break_above" if close > prior_high else "break_below" if close < prior_low else "inside_prior_range"}),
        "structure_prediction": _item(None, "NOT_A_PREDICTION", "No forward prediction is emitted; structure context is descriptive only."),
        "candle_patterns": _item(candle_pattern, "CANDIDATE_REQUIRES_VALIDATION"),
        "fvg": _item(fvg, "CANDIDATE_REQUIRES_VALIDATION", "Three-candle OHLCV gap candidate; not an order-block or execution guarantee."),
        "support_resistance": _item({"resistance": resistance, "support": support}, "RECENT_RANGE_LEVELS"),
        "volume_profile": _item(volume_profile_proxy, "OHLCV_CLOSE_BIN_PROXY", "Not tick-level or exchange-native volume profile."),
        "liquidity_sweeps": _item(sweep, "CANDIDATE_REQUIRES_VALIDATION"),
        "delta_buy_sell": _item(flow_values, "CALCULATED_LIVE_PROXY" if flow_valid else "UNAVAILABLE_UNLESS_VALIDATED_FEED",
                               "Live Delta Exchange BTCUSD public-trades feed; contract volume may differ from broker CFD volume." if flow_valid else "Requires a fresh, validated aggressor-volume feed."),
        "orderflow_footprint": _item({"source": flow_values["source"], "instrument_note": flow_values["instrument_note"],
                                      "levels": trade_flow.get("footprint", {})} if flow_valid else None,
                                     "CALCULATED_LIVE_PROXY" if flow_valid and isinstance(trade_flow.get("footprint"), dict) else "UNAVAILABLE_UNLESS_VALIDATED_FEED",
                                     "Trade-level price buckets from Delta Exchange public BTCUSD trades; not a broker-specific CFD footprint." if flow_valid else "Requires granular trade/price-level bid-ask data."),
        "divergence": _item(divergence, "CANDIDATE_REQUIRES_VALIDATION"),
        "trading_sessions": _item(session, "UTC_TIME_BUCKET_ONLY", "UTC bucket, not broker/exchange session calendar."),
        "day_high_low": _item({"day_high_utc": day_high, "day_low_utc": day_low}, "UTC_DAY_FROM_SUPPLIED_BARS"),
        "dxy_inverse": _item(None, "UNAVAILABLE_UNLESS_VALIDATED_FEED", "Requires synchronized DXY OHLCV and correlation window.") if not dxy_bars else _item(None, "PENDING_CORRELATION_VALIDATION", "DXY bars supplied but synchronized correlation calculation is not yet validated."),
        "us_high_impact_news": _item(None, "UNAVAILABLE_UNLESS_VALIDATED_FEED", "Requires validated economic calendar and release timestamps.") if not news_events else _item(None, "PENDING_NEWS_SCHEMA_VALIDATION", "Events supplied but calendar schema/impact mapping is not yet validated."),
    }
    return {
        "version": ROSTER_VERSION,
        "symbol": symbol,
        "timeframe": timeframe,
        "bar_count": len(bars),
        "latest_bar_timestamp": last.get("timestamp"),
        "ready_for_signal": False,
        "reason": "Diagnostics only. Scoring remains disabled until source freshness, multi-timeframe alignment and each indicator are validated.",
        "indicators": values,
    }
