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
    """SMA-seeded EMA; requires a full seed window and finite numeric input."""
    if period < 1 or len(values) < period:
        return None
    if any(not _finite(x) for x in values):
        return None
    alpha = 2.0 / (period + 1.0)
    value = sum(float(x) for x in values[:period]) / period
    for x in values[period:]:
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
        if x > 100_000_000_000_000:
            return x / 1_000_000.0
        if x > 100_000_000_000:
            return x / 1000.0
        return x
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


def _valid_aux_bars(raw: Sequence[Dict[str, Any]], minimum: int = 20) -> Optional[List[Dict[str, Any]]]:
    """Validate auxiliary OHLCV data without silently aligning unrelated timestamps."""
    if not isinstance(raw, (list, tuple)) or len(raw) < minimum:
        return None
    result = []
    stamps = []
    for bar in raw:
        if not isinstance(bar, dict) or not all(_finite(bar.get(k)) for k in ("open", "high", "low", "close", "volume")):
            return None
        o, h, l, c, v = (float(bar[k]) for k in ("open", "high", "low", "close", "volume"))
        if min(o, h, l, c) <= 0 or v < 0 or h < max(o, c, l) or l > min(o, c, h):
            return None
        stamp = _stamp_seconds(bar.get("timestamp"))
        if stamp is None:
            return None
        stamps.append(stamp)
        result.append(bar)
    if any(stamps[i] <= stamps[i - 1] for i in range(1, len(stamps))):
        return None
    return result



def _valid_footprint(raw: Any) -> bool:
    """Require a non-empty price-level map with finite, non-negative two-sided volume."""
    if not isinstance(raw, dict) or not raw:
        return False
    for price, level in raw.items():
        try:
            price_value = float(price)
        except (TypeError, ValueError):
            return False
        if not isfinite(price_value) or price_value <= 0 or not isinstance(level, dict):
            return False
        buy = level.get("buy", level.get("buy_volume"))
        sell = level.get("sell", level.get("sell_volume"))
        if not _finite(buy) or not _finite(sell) or float(buy) < 0 or float(sell) < 0:
            return False
        if float(buy) + float(sell) <= 0:
            return False
    return True


def _pearson(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    """Pearson correlation with a strict zero-variance guard."""
    if len(xs) != len(ys) or len(xs) < 20:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    dx, dy = [x - mx for x in xs], [y - my for y in ys]
    sx = sum(x * x for x in dx)
    sy = sum(y * y for y in dy)
    if sx <= 1e-18 or sy <= 1e-18:
        return None
    return sum(x * y for x, y in zip(dx, dy)) / (sx * sy) ** 0.5



def _news_filter(events: Optional[Sequence[Dict[str, Any]]]) -> Dict[str, Any]:
    """Evaluate a strict, explicit economic-calendar payload; never infer a clear calendar from no data."""
    unavailable = {"value": None, "status": "UNAVAILABLE_UNLESS_VALIDATED_FEED",
                   "note": "Requires fresh, validated calendar records with source, observed_at, USD currency, impact and event timestamp."}
    if not isinstance(events, (list, tuple)) or not events:
        return unavailable
    now = datetime.now(timezone.utc).timestamp()
    normalized = []
    sources = set()
    for event in events:
        if not isinstance(event, dict):
            return {"value": None, "status": "INVALID_CALENDAR_PAYLOAD", "note": "Every calendar event must be an object."}
        if event.get("feed_status") != "LIVE" or event.get("validated") is not True:
            return unavailable
        source = str(event.get("source", "")).strip()
        currency = str(event.get("currency", "")).strip().upper()
        impact = str(event.get("impact", "")).strip().lower()
        event_stamp = _stamp_seconds(event.get("timestamp"))
        observed = _stamp_seconds(event.get("observed_at"))
        if not source or currency not in {"USD", "US"} or impact not in {"high", "3", "high impact"} or event_stamp is None or observed is None:
            return {"value": None, "status": "INVALID_CALENDAR_PAYLOAD", "note": "Calendar event schema or USD/high-impact classification is invalid."}
        age = now - observed
        if age < -60 or age > 6 * 60 * 60:
            return {"value": None, "status": "STALE_CALENDAR_FEED", "note": "Calendar observation timestamp must be fresh (within six hours)."}
        sources.add(source)
        normalized.append((event_stamp, str(event.get("title", "US high-impact event"))))
    if len(sources) != 1:
        return {"value": None, "status": "MIXED_CALENDAR_SOURCES", "note": "A single validated calendar source is required per request."}
    active = [{"timestamp": stamp, "title": title} for stamp, title in normalized if now - 15 * 60 <= stamp <= now + 30 * 60]
    if active:
        return {"value": {"blocked": True, "active_events": active, "source": next(iter(sources))},
                "status": "VALIDATED_EVENT_WINDOW", "note": "High-impact US event is within the configured 15-minute post / 30-minute pre window."}
    return {"value": {"blocked": False, "active_events": [], "source": next(iter(sources))},
            "status": "VALIDATED_NO_NEAR_EVENT", "note": "Validated calendar has no high-impact USD event in the configured window."}


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
    timestamps = []
    for i, bar in enumerate(bars):
        if not isinstance(bar, dict):
            raise ValueError("bar %d must be an object" % i)
        if not all(_finite(bar.get(k)) for k in ("open", "high", "low", "close", "volume")):
            raise ValueError("bar %d has missing or non-numeric OHLCV" % i)
        open_, high, low, close_, volume = (float(bar[k]) for k in ("open", "high", "low", "close", "volume"))
        if min(open_, high, low, close_) <= 0:
            raise ValueError("bar %d has non-positive OHLC prices" % i)
        if low > min(open_, close_) or high < max(open_, close_) or high < low:
            raise ValueError("bar %d has invalid high/low bounds" % i)
        if volume < 0:
            raise ValueError("bar %d has negative volume" % i)
        stamp = _stamp_seconds(bar.get("timestamp"))
        if stamp is None:
            raise ValueError("bar %d has missing or invalid timestamp" % i)
        timestamps.append(stamp)
    if any(timestamps[i] <= timestamps[i - 1] for i in range(1, len(timestamps))):
        raise ValueError("bar timestamps must be strictly increasing")

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

    # Engine 2: confirmed two-sided pivots, structure breaks, and active FVGs.
    # A pivot is only confirmed after two candles have printed to its right.
    pivot_highs, pivot_lows = [], []
    for i in range(2, len(bars) - 2):
        hi = float(bars[i]["high"])
        lo = float(bars[i]["low"])
        if all(hi > float(bars[j]["high"]) for j in (i-2, i-1, i+1, i+2)):
            pivot_highs.append((i, hi))
        if all(lo < float(bars[j]["low"]) for j in (i-2, i-1, i+1, i+2)):
            pivot_lows.append((i, lo))
    recent_ph = [p for p in pivot_highs if p[0] >= max(0, len(bars)-60)]
    recent_pl = [p for p in pivot_lows if p[0] >= max(0, len(bars)-60)]
    resistance_candidates = [p for _, p in recent_ph if p >= close]
    support_candidates = [p for _, p in recent_pl if p <= close]
    resistance = min(resistance_candidates) if resistance_candidates else (max((p for _, p in recent_ph), default=max(highs[-20:])))
    support = max(support_candidates) if support_candidates else (min((p for _, p in recent_pl), default=min(lows[-20:])))
    prior_window = min(20, len(bars)-1)
    prior_high = max(highs[-prior_window-1:-1])
    prior_low = min(lows[-prior_window-1:-1])
    sweep = "none"
    if highs[-1] > prior_high and close < prior_high:
        sweep = "buy-side liquidity sweep candidate"
    elif lows[-1] < prior_low and close > prior_low:
        sweep = "sell-side liquidity sweep candidate"

    # Find the newest still-active 3-candle FVG in the recent lookback.
    # A bullish gap is fully filled only when a later low reaches its lower edge;
    # a bearish gap is fully filled only when a later high reaches its upper edge.
    fvg = None
    fvg_start = max(2, len(bars) - 80)
    for i in range(len(bars) - 1, fvg_start - 1, -1):
        left, right = bars[i-2], bars[i]
        left_high, left_low = float(left["high"]), float(left["low"])
        right_high, right_low = float(right["high"]), float(right["low"])
        if right_low > left_high:
            lower, upper = left_high, right_low
            later = bars[i+1:]
            fully_filled = any(float(b["low"]) <= lower for b in later)
            if not fully_filled:
                partially_filled = any(float(b["low"]) < upper for b in later)
                fvg = {"type": "bullish", "lower": lower, "upper": upper,
                       "fill_status": "partially_filled" if partially_filled else "unfilled",
                       "formed_at": right.get("timestamp")}
                break
        if right_high < left_low:
            lower, upper = right_high, left_low
            later = bars[i+1:]
            fully_filled = any(float(b["high"]) >= upper for b in later)
            if not fully_filled:
                partially_filled = any(float(b["high"]) > lower for b in later)
                fvg = {"type": "bearish", "lower": lower, "upper": upper,
                       "fill_status": "partially_filled" if partially_filled else "unfilled",
                       "formed_at": right.get("timestamp")}
                break

    # Price-action structure: compare the two latest confirmed swing highs/lows.
    structure = {"trend": "unconfirmed", "higher_high": None, "higher_low": None,
                 "break": "none", "latest_swing_high": recent_ph[-1][1] if recent_ph else None,
                 "latest_swing_low": recent_pl[-1][1] if recent_pl else None}
    if len(recent_ph) >= 2 and len(recent_pl) >= 2:
        hh = recent_ph[-1][1] > recent_ph[-2][1]
        lh = recent_ph[-1][1] < recent_ph[-2][1]
        hl = recent_pl[-1][1] > recent_pl[-2][1]
        ll = recent_pl[-1][1] < recent_pl[-2][1]
        structure.update({"higher_high": hh, "higher_low": hl,
                          "trend": "bullish_structure" if hh and hl else
                                   "bearish_structure" if lh and ll else "mixed_or_range"})
    if close > prior_high:
        structure["break"] = "bullish_break_of_structure_candidate"
    elif close < prior_low:
        structure["break"] = "bearish_break_of_structure_candidate"

    body = close - float(last["open"])
    candle_range = float(last["high"]) - float(last["low"])
    upper_wick = float(last["high"]) - max(float(last["open"]), close)
    lower_wick = min(float(last["open"]), close) - float(last["low"])
    candle_pattern = "neutral"
    if len(bars) >= 2:
        previous = bars[-2]
        prev_open, prev_close = float(previous["open"]), float(previous["close"])
        bullish_engulf = (prev_close < prev_open and close > float(last["open"])
                          and float(last["open"]) <= prev_close and close >= prev_open)
        bearish_engulf = (prev_close > prev_open and close < float(last["open"])
                          and float(last["open"]) >= prev_close and close <= prev_open)
        if bullish_engulf:
            candle_pattern = "bullish engulfing candidate"
        elif bearish_engulf:
            candle_pattern = "bearish engulfing candidate"
    if candle_pattern == "neutral":
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
    profile_volume_total = sum(volumes[-30:])
    if profile_volume_total <= 0:
        volume_profile_proxy = None
        volume_profile_status = "UNAVAILABLE_NO_VOLUME"
        volume_profile_note = "The last 30 bars contain no positive volume; a highest-volume bin cannot be identified."
    elif high30 > low30:
        for b in bars[-30:]:
            idx = int((float(b["close"]) - low30) / (high30 - low30) * 12)
            profile_bins[min(11, max(0, idx))] += float(b["volume"])
        profile_idx = max(range(12), key=lambda i: profile_bins[i])
        volume_profile_proxy = {"highest_close_bin": profile_idx, "bin_low": low30 + (high30-low30)*profile_idx/12,
                                "bin_high": low30 + (high30-low30)*(profile_idx+1)/12}
        volume_profile_status = "OHLCV_CLOSE_BIN_PROXY"
        volume_profile_note = "Not tick-level or exchange-native volume profile."
    else:
        volume_profile_proxy = {"highest_close_bin": 0, "bin_low": low30, "bin_high": high30}
        volume_profile_status = "OHLCV_CLOSE_BIN_PROXY"
        volume_profile_note = "Constant-price OHLCV close-bin proxy; not tick-level or exchange-native volume profile."

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
        instrument = str(trade_flow.get("instrument", "")).strip().upper().replace("/", "").replace("-", "")
        expected_instrument = str(symbol).strip().upper().replace("/", "").replace("-", "")
        trade_count = trade_flow.get("trade_count")
        # Validate freshness, matching instrument, positive volume and minimum trade sample.
        if (source == "Delta Exchange public BTCUSD trades API"
                and instrument == expected_instrument == "BTCUSD"
                and age_seconds is not None and -30 <= age_seconds <= 120
                and _finite(buy_volume) and _finite(sell_volume)
                and float(buy_volume) >= 0 and float(sell_volume) >= 0
                and _finite(trade_count) and int(trade_count) >= 10
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
        "ema_9_21": _item(
            {"ema9": e9, "ema21": e21,
             "spread": (e9 - e21) if e9 is not None and e21 is not None else None,
             "spread_percent": (100.0 * (e9 - e21) / close) if e9 is not None and e21 is not None and close else None,
             "bias": "bullish" if e9 is not None and e21 is not None and e9 > e21 else
                     "bearish" if e9 is not None and e21 is not None and e9 < e21 else "neutral"},
            "CALCULATED_CANDIDATE" if e9 is not None and e21 is not None else "INSUFFICIENT_HISTORY",
            "SMA-seeded EMA(9) and EMA(21), newest candle last; candidate only pending live-feed and reference-value validation."),
        "rsi_14": _item(rsi, "CALCULATED" if rsi is not None else "INSUFFICIENT_HISTORY"),
        "trend_5": _item(None, "UNAVAILABLE_MISSING_TIMEFRAME_CONTEXT", "Requires at least 20 timestamped, validated higher-timeframe candles.") if not higher_timeframe_bars else _item(
            (lambda aux: {"ema9": _ema([float(b["close"]) for b in aux], 9),
                          "ema21": _ema([float(b["close"]) for b in aux], 21),
                          "bias": "bullish" if _ema([float(b["close"]) for b in aux], 9) > _ema([float(b["close"]) for b in aux], 21)
                                  else "bearish" if _ema([float(b["close"]) for b in aux], 9) < _ema([float(b["close"]) for b in aux], 21)
                                  else "neutral"} if aux else None)(_valid_aux_bars(higher_timeframe_bars, 21)),
            "CALCULATED_CANDIDATE" if _valid_aux_bars(higher_timeframe_bars, 21) else "INVALID_HIGHER_TIMEFRAME_DATA",
            "EMA 9/21 on supplied higher-timeframe candles; caller must ensure timeframe and symbol match."),
        "vwap_filter": _item({"rolling_20_bar_vwap": vwap20, "bias": "above" if vwap20 is not None and close > vwap20 else "below" if vwap20 is not None and close < vwap20 else "at_or_unavailable"}, "PROXY_NOT_SESSION_VWAP", "Rolling 20-bar OHLCV proxy, not true exchange/session VWAP."),
        "volatility_regime": _item(regime, "CALCULATED" if regime else "INSUFFICIENT_HISTORY"),
        "atr_14": _item(atr, "CALCULATED" if atr is not None else "INSUFFICIENT_HISTORY"),
        "market_structure": _item(structure, "CALCULATED_CANDIDATE" if len(recent_ph) >= 2 and len(recent_pl) >= 2 else "INSUFFICIENT_CONFIRMED_SWINGS", "Confirmed two-sided pivots; latest two highs and lows are compared. Breaks are candidates, not guaranteed trend changes."),
        "structure_prediction": _item(
            {"candidate": "bullish_continuation_candidate" if structure["trend"] == "bullish_structure" and close > float(last["open"]) else
                         "bearish_continuation_candidate" if structure["trend"] == "bearish_structure" and close < float(last["open"]) else
                         "range_or_reversal_unconfirmed",
             "structure": structure["trend"], "close": close,
             "prior_range_high": prior_high, "prior_range_low": prior_low},
            "DESCRIPTIVE_CANDIDATE_ONLY",
            "Rule-based scenario derived from confirmed pivots and latest candle; not a forecast."),
        "candle_patterns": _item(candle_pattern, "CANDIDATE_REQUIRES_VALIDATION"),
        "fvg": _item(fvg, "CALCULATED_CANDIDATE" if fvg else "NO_ACTIVE_FVG", "Newest recent three-candle gap that has not been fully filled; partial fills are labeled."),
        "support_resistance": _item({"resistance": resistance, "support": support,
                                     "resistance_basis": "nearest_confirmed_pivot_or_recent_extreme",
                                     "support_basis": "nearest_confirmed_pivot_or_recent_extreme"},
                                    "CALCULATED_CANDIDATE" if recent_ph or recent_pl else "RECENT_RANGE_FALLBACK",
                                    "Levels are descriptive OHLC pivots/extremes, not guaranteed support or resistance."),
        "volume_profile": _item(volume_profile_proxy, volume_profile_status, volume_profile_note),
        "liquidity_sweeps": _item(sweep, "CANDIDATE_REQUIRES_VALIDATION"),
        "delta_buy_sell": _item(flow_values, "CALCULATED_LIVE_PROXY" if flow_valid else "UNAVAILABLE_UNLESS_VALIDATED_FEED",
                               "Live Delta Exchange BTCUSD public-trades feed; contract volume may differ from broker CFD volume." if flow_valid else "Requires a fresh, validated aggressor-volume feed."),
        "orderflow_footprint": _item({"source": flow_values["source"], "instrument_note": flow_values["instrument_note"],
                                      "levels": trade_flow.get("footprint", {})} if flow_valid and _valid_footprint(trade_flow.get("footprint")) else None,
                                     "CALCULATED_LIVE_PROXY" if flow_valid and _valid_footprint(trade_flow.get("footprint")) else "UNAVAILABLE_INVALID_FOOTPRINT_PAYLOAD" if flow_valid else "UNAVAILABLE_UNLESS_VALIDATED_FEED",
                                     "Trade-level price buckets from Delta Exchange public BTCUSD trades; not a broker-specific CFD footprint." if flow_valid else "Requires granular trade/price-level bid-ask data."),
        "divergence": _item(divergence, "CANDIDATE_REQUIRES_VALIDATION"),
        "trading_sessions": _item(session, "UTC_TIME_BUCKET_ONLY", "UTC bucket, not broker/exchange session calendar."),
        "day_high_low": _item({"day_high_utc": day_high, "day_low_utc": day_low}, "UTC_DAY_FROM_SUPPLIED_BARS"),
        "dxy_inverse": _item(None, "UNAVAILABLE_UNLESS_VALIDATED_FEED", "Requires at least 20 synchronized, timestamp-matched DXY candles.") if not dxy_bars else _item(
            (lambda aux: (lambda pairs: (lambda corr: {"correlation": corr, "classification": "inverse" if corr is not None and corr <= -0.30 else "positive" if corr is not None and corr >= 0.30 else "weak_or_unclear", "matched_returns": len(pairs)} if corr is not None else None)(
                _pearson([p[0] for p in pairs], [p[1] for p in pairs])))([(100.0*(float(b["close"])/float(a["close"])-1.0), 100.0*(float(d["close"])/float(c["close"])-1.0))
                    for a,b,c,d in zip(bars[:-1], bars[1:], aux[:-1], aux[1:])
                    if _stamp_seconds(a.get("timestamp")) == _stamp_seconds(c.get("timestamp"))
                    and _stamp_seconds(b.get("timestamp")) == _stamp_seconds(d.get("timestamp"))])
             if aux else None)(_valid_aux_bars(dxy_bars, 21)),
            "CALCULATED_CANDIDATE" if _valid_aux_bars(dxy_bars, 21) else "INVALID_DXY_DATA",
            "Pearson correlation of timestamp-matched candle returns; candidate only until DXY source, symbol and synchronization are independently verified."),
        "us_high_impact_news": _news_filter(news_events),
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
