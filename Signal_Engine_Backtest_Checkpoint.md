# Signal Engine Backtest Checkpoint

## Current status
- Signal states: BUY / SELL / NO TRADE
- Backtest status: NOT RUN
- Reason: exact signal rules and historical dataset are not yet frozen/loaded
- No performance result is claimed.

## Required test sequence
1. Freeze signal rules
2. Load historical OHLCV data
3. Candle-by-candle execution with no look-ahead
4. Entry/SL/TP simulation
5. Metrics: win rate, profit factor, net P&L, max drawdown, streaks
6. Out-of-sample validation
7. Save verified results to dashboard

Auto Execution: OFF
Trading mode: Manual Trading
