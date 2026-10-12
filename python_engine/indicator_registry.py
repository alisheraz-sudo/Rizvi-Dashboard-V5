"""Canonical locked 20-indicator contract for Rizvi Dashboard V5 Stage 1.

This registry is metadata only: it never fabricates indicator values or feed health.
An indicator is not marked LIVE merely because its name exists in the registry.
"""
from typing import Any, Dict, List

ROSTER_VERSION = "rizvi-v5-locked-20-v1"
ENGINES = [
    {
        "id": 1,
        "name": "Trend, Momentum & Regime",
        "indicators": [
            {"id": "ema_9_21", "name": "EMA 9/21", "source": "ohlcv", "status": "IMPLEMENTED_CANDIDATE_PENDING_LIVE_VALIDATION"},
            {"id": "rsi_14", "name": "RSI (14)", "source": "ohlcv", "status": "LEGACY_CALCULATION_REQUIRES_VALIDATION"},
            {"id": "trend_5", "name": "Trend (5)", "source": "multi_timeframe_ohlcv", "status": "PENDING_IMPLEMENTATION"},
            {"id": "vwap_filter", "name": "VWAP Filter", "source": "ohlcv_volume", "status": "LEGACY_PROXY_REQUIRES_VALIDATION"},
            {"id": "volatility_regime", "name": "Volatility Regime Filter", "source": "ohlcv", "status": "LEGACY_CALCULATION_REQUIRES_VALIDATION"},
            {"id": "atr_14", "name": "ATR (14)", "source": "ohlcv", "status": "LEGACY_CALCULATION_REQUIRES_VALIDATION"},
        ],
    },
    {
        "id": 2,
        "name": "Structure & Liquidity",
        "indicators": [
            {"id": "market_structure", "name": "Market Structure", "source": "ohlcv", "status": "IMPLEMENTED_CANDIDATE_PENDING_LIVE_VALIDATION"},
            {"id": "structure_prediction", "name": "Structure Prediction", "source": "ohlcv", "status": "DESCRIPTIVE_CANDIDATE_NOT_FORECAST"},
            {"id": "candle_patterns", "name": "Candle Patterns / Price Action", "source": "ohlcv", "status": "IMPLEMENTED_CANDIDATE_PENDING_LIVE_VALIDATION"},
            {"id": "fvg", "name": "Fair Value Gap (FVG)", "source": "ohlcv", "status": "IMPLEMENTED_CANDIDATE_PENDING_LIVE_VALIDATION"},
            {"id": "support_resistance", "name": "Support & Resistance", "source": "ohlcv", "status": "IMPLEMENTED_CANDIDATE_PENDING_LIVE_VALIDATION"},
        ],
    },
    {
        "id": 3,
        "name": "Volume, Liquidity & Order Flow",
        "indicators": [
            {"id": "volume_profile", "name": "Volume Profile", "source": "ohlcv_volume", "status": "LEGACY_PROXY_NOT_TRUE_PROFILE"},
            {"id": "liquidity_sweeps", "name": "Liquidity Pools / Sweeps", "source": "ohlcv", "status": "PENDING_IMPLEMENTATION"},
            {"id": "delta_buy_sell", "name": "Delta Buy/Sell", "source": "bid_ask_trade_data", "status": "UNAVAILABLE_UNLESS_VALIDATED_FEED"},
            {"id": "orderflow_footprint", "name": "Order Flow / Footprint", "source": "granular_bid_ask_or_trade_data", "status": "UNAVAILABLE_UNLESS_VALIDATED_FEED"},
        ],
    },
    {
        "id": 4,
        "name": "Confirmation, Sessions & External Filters",
        "indicators": [
            {"id": "divergence", "name": "Bullish/Bearish Divergence", "source": "ohlcv", "status": "PENDING_IMPLEMENTATION"},
            {"id": "trading_sessions", "name": "Trading Sessions", "source": "timestamp_and_session_calendar", "status": "PENDING_IMPLEMENTATION"},
            {"id": "day_high_low", "name": "Day High / Day Low", "source": "session_ohlcv", "status": "PENDING_IMPLEMENTATION"},
            {"id": "dxy_inverse", "name": "DXY Inverse-Correlation Filter", "source": "synchronized_dxy_feed", "status": "UNAVAILABLE_UNLESS_VALIDATED_FEED"},
            {"id": "us_high_impact_news", "name": "High-Impact US News Filter", "source": "validated_economic_calendar", "status": "UNAVAILABLE_UNLESS_VALIDATED_FEED"},
        ],
    },
]

def roster_snapshot() -> Dict[str, Any]:
    """Return a fresh JSON-safe copy so API consumers cannot mutate the registry."""
    engines: List[Dict[str, Any]] = []
    for engine in ENGINES:
        items = [dict(item) for item in engine["indicators"]]
        engines.append({
            "id": engine["id"],
            "name": engine["name"],
            "indicator_count": len(items),
            "indicators": items,
            "status": "PENDING_VALIDATION",
        })
    all_items = [item for engine in engines for item in engine["indicators"]]
    return {
        "version": ROSTER_VERSION,
        "expected_count": 20,
        "actual_count": len(all_items),
        "engine_counts": {str(engine["id"]): engine["indicator_count"] for engine in engines},
        "engines": engines,
        "ready_for_signal": False,
        "reason": "Stage 1 contract is registered; indicator calculations, feeds and end-to-end alignment still require validation.",
    }
