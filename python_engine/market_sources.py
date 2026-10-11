"""Optional public-market diagnostics. No trading or account permissions are used."""
import json
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen


 _FLOW_CACHE = {}
_FLOW_CACHE_AT = {}


def fetch_binance_trade_flow(symbol="BTCUSDT", limit=500):
    """Return a short BTCUSDT spot aggressor-flow snapshot, explicitly a proxy for BTCUSD."""
    if str(symbol).upper() not in {"BTCUSD", "BTCUSDT", "BTC-USD", "BTC/USD"}:
        return None
    cache_key = str(symbol).upper()
    now = time.time()
    if cache_key in _FLOW_CACHE and now - _FLOW_CACHE_AT.get(cache_key, 0) < 5:
        return _FLOW_CACHE[cache_key]
    params = urlencode({"symbol": "BTCUSDT", "limit": max(50, min(int(limit), 1000))})
    request = Request(
        "https://data-api.binance.vision/api/v3/aggTrades?" + params,
        headers={"User-Agent": "RizviDashboardV5/1.0", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=3.0) as response:
            if response.status != 200:
                return None
            trades = json.loads(response.read(1_000_000).decode("utf-8"))
    except Exception:
        _FLOW_CACHE[cache_key] = None
        _FLOW_CACHE_AT[cache_key] = now
        return None
    if not isinstance(trades, list) or len(trades) < 10:
        _FLOW_CACHE[cache_key] = None
        _FLOW_CACHE_AT[cache_key] = now
        return None

    buy_volume = 0.0
    sell_volume = 0.0
    footprint = {}
    times = []
    for trade in trades:
        try:
            price = float(trade["p"])
            qty = float(trade["q"])
            stamp = int(trade["T"])
            buyer_is_maker = trade["m"]
            if price <= 0 or qty < 0 or not isinstance(buyer_is_maker, bool):
                continue
        except (KeyError, TypeError, ValueError):
            continue
        # If buyer is maker, the taker/aggressor was a seller.
        side = "sell" if buyer_is_maker else "buy"
        if side == "buy":
            buy_volume += qty
        else:
            sell_volume += qty
        key = format(price, ".2f")
        level = footprint.setdefault(key, {"buy_volume": 0.0, "sell_volume": 0.0, "trades": 0})
        level[side + "_volume"] += qty
        level["trades"] += 1
        times.append(stamp)

    total = buy_volume + sell_volume
    if not times or total <= 0:
        _FLOW_CACHE[cache_key] = None
        _FLOW_CACHE_AT[cache_key] = now
        return None
    result = {
        "status": "LIVE",
        "source": "Binance Spot BTCUSDT aggregate trades",
        "instrument": "BTCUSDT",
        "instrument_note": "Spot-market proxy; not the user's BTCUSD broker CFD feed.",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "window_start_ms": min(times),
        "window_end_ms": max(times),
        "trade_count": len(times),
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "delta_volume": buy_volume - sell_volume,
        "delta_percent": 100.0 * (buy_volume - sell_volume) / total,
        "footprint": footprint,
    }
    _FLOW_CACHE[cache_key] = result
    _FLOW_CACHE_AT[cache_key] = now
    return result
