# Rizvi Dashboard V5 — Development Checkpoint

## Current architecture
- Primary target: Native iOS app on iPhone
- Railway: parked/side-lined for now; do not modify or delete
- Trading mode: Manual Trading
- Auto Trading: OFF
- Paper trading: simulated only

## Completed UI/engine work
- Dark V5 trading dashboard layout
- XAU/USD primary symbol + Forex/Crypto selector architecture
- Signal engine and setup lifecycle/stale-signal protection
- BUY/SELL Combo badge with dynamic colors
- HIGH QUALITY + 3-button state
- Compact Entry / TP / SL execution block
- Extra duplicate setup area replaced with mini candle chart
- High / Low / Current Price display
- Backtesting, risk, MTF, regime, liquidity, correlation and journal modules retained
- Premium visual polish retained

## Native iOS build preparation
- Capacitor native configuration present with app ID `com.rizvi.dashboard`
- iOS callback scheme configured
- Capacitor dependencies pinned to reproducible 7.x versions
- GitHub Actions macOS/iOS simulator build workflow added
- Workflow generates the native iOS project, syncs Capacitor, builds an unsigned simulator app, and uploads an artifact
- Workflow execution has not yet been independently verified through the available GitHub Actions interface

## Current market-data integration
- Added `ctrader-adapter.js`
- cTrader Open API WebSocket flow scaffolded
- OAuth authorization flow scaffolded
- Account discovery + live/demo endpoint selection scaffolded
- Broker symbol discovery/mapping scaffolded
- Live bid/ask subscription scaffolded
- Live trendbar subscription scaffolded
- Historical trendbar loading scaffolded
- Main and mini charts can consume OHLC bars
- iOS callback/browser flow scaffolded
- No trading/order endpoint is enabled

## Pending
1. Register/configure the cTrader Open API application for the user's FxPro account.
2. Complete and verify native iOS project generation/signing and callback registration.
3. Authorize the user's FxPro cTrader account without exposing credentials in chat.
4. Verify real XAU/USD + selected Forex/Crypto symbols and timeframe candles on iPhone.
5. Run end-to-end signal/backtest/UI regression testing.
6. After iOS is stable, decide whether Railway should remain as a backup or be retired.

## Rule
Add → Test → Fix → Save → Next
