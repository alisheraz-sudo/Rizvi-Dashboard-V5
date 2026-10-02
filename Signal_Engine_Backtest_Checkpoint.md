# Signal Engine Backtest Checkpoint

## Status
- Backtest engine: IMPLEMENTED
- Historical execution: candle-by-candle
- Look-ahead: OFF
- Auto Execution: OFF
- Trading mode: Manual Trading
- Current dataset: XAU/USD 5-minute GitHub sample
- Historical sample source: getdata-finance XAUUSD 5m OHLCV
- Actual performance result: NOT YET CLAIMED — the browser runner must fetch/process the dataset.

## Deterministic test rules
- EMA trend: EMA20 vs EMA50 on 5m.
- RSI: 14-period; BUY range 55–70, SELL range 30–45.
- VWAP: session VWAP using UTC calendar day and OHLCV tick volume.
- Market structure: BUY requires close above the previous 20-bar high; SELL requires close below the previous 20-bar low.
- Multi-timeframe confirmation: previous completed 15m and 60m buckets must have EMA20/EMA50 trend aligned with the 5m trend.
- Entry: signal candle close.
- Stop: prior 10-bar swing low/high.
- Risk filter: stop distance must be >0 and <1% of entry.
- Targets: TP1=1R, TP2=2R, TP3=3R.
- Exit priority when one OHLC candle touches multiple levels: SL is treated first (conservative ambiguity handling).
- Position sizing for reporting: 1/3 at TP1, 1/3 at TP2, 1/3 at TP3; reported result is normalized R.
- One open trade at a time.

## Next validation
1. Open the latest Chrome/GitHub Pages build.
2. Press **Run XAU/USD 5M Backtest**.
3. Confirm bars, trades, win rate, net R, profit factor, and max drawdown.
4. Then add out-of-sample validation before treating the result as a strategy-performance claim.
