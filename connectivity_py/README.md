# Python canonical feed contract (isolated / not production-connected)

This directory introduces a small, dependency-free Python validation core for the Rizvi Dashboard V5 feed hand-off. It is deliberately separate from the current Node.js server and browser UI.

## Current scope
- Canonicalize XAU/USD aliases and reject unsupported symbols (including legacy BTCUSD).
- Normalize epoch seconds, epoch milliseconds, and ISO timestamps.
- Validate OHLC integrity, duplicate/future timestamps, bar count, feed status, symbol/timeframe agreement, and latest-bar freshness.
- Return explicit failure reasons for diagnostics.
- Never compute indicators, issue BUY/SELL signals, alter Engine 5 scoring/thresholds, or execute trades.

## Run tests
```sh
python -m unittest discover -s tests -p 'test_*.py' -v
```

## Integration boundary
This is not yet called by `server.js` or the browser bridge and is not deployed. Do not route production signals through it until the Node-to-Python API contract, authentication, timeout/fallback behavior, and live XAU market tests are implemented and reviewed. Engine 5 remains the existing master; Auto Trading stays OFF.
