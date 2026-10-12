"""Read-only public market-data adapters for Rizvi Dashboard V5."""
import json
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

_FLOW_CACHE = {}
_FLOW_CACHE_AT = {}


def _to_epoch_seconds(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        stamp = float(value)
        if stamp > 100_000_000_000_000:  # microseconds
            stamp /= 1_000_000.0
        elif stamp > 100_000_000_000:  # milliseconds
            stamp /= 1_000.0
        return stamp if stamp > 0 else None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            try:
                return _to_epoch_seconds(float(value))
            except ValueError:
                return None
    return None


def fetch_delta_trade_flow(symbol="BTCUSD", limit=500):
    """Fetch public Delta Exchange BTCUSD trades and build buy/sell delta + price buckets.

    This is read-only public data. It does not authenticate, access accounts, or trade.
    The exchange contract may differ from the user's broker CFD; size units are exchange
    contract sizes, so the output is a source-specific diagnostic, not broker volume.
    """
    normalized = str(symbol).strip().upper().replace("/", "").replace("-", "")
    if normalized not in {"BTCUSD", "BTCUSDT"}:
        return None
    cache_key = normalized
    now = time.time()
    if cache_key in _FLOW_CACHE and now - _FLOW_CACHE_AT.get(cache_key, 0) < 5:
        return _FLOW_CACHE[cache_key]

    # Delta's public market-data endpoint requires no API key.
    url = "https://api.india.delta.exchange/v2/trades/" + normalized
    request = Request(url, headers={
        "User-Agent": "RizviDashboardV5/1.0",
        "Accept": "application/json",
    })
    try:
        with urlopen(request, timeout=1.0) as response:
            if response.status != 200:
                raise ValueError("non-200 market-data response")
            payload = json.loads(response.read(1_000_000).decode("utf-8"))
        if not isinstance(payload, dict) or payload.get("success") is False:
            raise ValueError("invalid market-data envelope")
        result = payload.get("result", {})
        trades = result.get("trades", []) if isinstance(result, dict) else []
        if not isinstance(trades, list):
            raise ValueError("invalid trades array")
    except Exception:
        _FLOW_CACHE[cache_key] = None
        _FLOW_CACHE_AT[cache_key] = now
        return None

    buy_volume = sell_volume = 0.0
    footprint = {}
    timestamps = []
    valid_trades = 0
    for trade in trades[-max(50, min(int(limit), 1000)):]:
        if not isinstance(trade, dict):
            continue
        try:
            side = str(trade.get("side", "")).strip().lower()
            price = float(trade["price"])
            size = float(trade.get("size", trade.get("qty", 0)))
            stamp = _to_epoch_seconds(trade.get("timestamp", trade.get("time")))
            if side not in {"buy", "sell"} or price <= 0 or size <= 0 or stamp is None:
                continue
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        if side == "buy":
            buy_volume += size
        else:
            sell_volume += size
        price_key = format(price, ".2f")
        level = footprint.setdefault(price_key, {"buy_volume": 0.0, "sell_volume": 0.0, "trades": 0})
        level[side + "_volume"] += size
        level["trades"] += 1
        timestamps.append(stamp)
        valid_trades += 1

    total = buy_volume + sell_volume
    latest = max(timestamps) if timestamps else None
    age = now - latest if latest is not None else None
    # Fail closed if exchange trade timestamps are missing/stale or implausibly future-dated.
    if valid_trades < 10 or total <= 0 or age is None or age < -30 or age > 120:
        _FLOW_CACHE[cache_key] = None
        _FLOW_CACHE_AT[cache_key] = now
        return None

    result = {
        "status": "LIVE",
        "source": "Delta Exchange public BTCUSD trades API",
        "instrument": normalized,
        "instrument_note": "Delta Exchange contract trade sizes; not guaranteed to match the user's broker CFD volume.",
        "observed_at": datetime.fromtimestamp(latest, timezone.utc).isoformat(),
        "trade_count": valid_trades,
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "delta_volume": buy_volume - sell_volume,
        "delta_percent": 100.0 * (buy_volume - sell_volume) / total,
        "footprint": footprint,
    }
    _FLOW_CACHE[cache_key] = result
    _FLOW_CACHE_AT[cache_key] = now
    return result
