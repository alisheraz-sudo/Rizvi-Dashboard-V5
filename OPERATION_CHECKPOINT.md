# Rizvi Dashboard V5 — Operation Checkpoint

## Purpose
Preserve the current operational options, settings, architecture, and decisions so work can resume from this stage without rebuilding context.

## Approved UI / Layout
- Approved master screenshot remains the visual reference.
- Desktop/laptop is the primary layout.
- Preserve the approved dark/light color system.
- Current layout includes:
  1. BUY / SELL / UNWIND signal controls
  2. Signal Direction + Setup Quality
  3. Candlestick chart with Entry / SL / TP1 / TP2 / TP3
  4. SIGNAL — Market Analysis
  5. EXECUTION — Trade Qualification (signal qualification only, not broker execution)
  6. TRADE RANGE
  7. MARKET RANGE — Liquidity Levels
  8. Example 1 / Example 2 / UNWIND cards
  9. Legend
- Mobile is temporary; do not redesign the desktop layout to accommodate mobile.
- Latest mobile alignment work only narrows top controls/left panel and moves the left panel upward.

## Signal Semantics
- BUY / SELL / UNWIND are signal states, not broker order buttons.
- EXECUTION means trade/signal qualification only.
- No broker order placement, account balance, equity, margin, or manual order-entry UI.
- Auto-trading remains OFF unless explicitly requested later.

## Current Symbols
- BTCUSD — active live source.
- XAU/USD — live spot/history source connected.
- USOIL — symbol architecture exists but remains pending until an authorized/verified cTrader symbol/feed is available.
- Do not fake USOIL data.

## Live Data Sources
- BTC spot: Coinbase BTC-USD spot endpoint.
- BTC candles: Coinbase Exchange BTC-USD candles.
- BTC Market Range: Binance BTCUSDT 15-minute klines.
- Gold spot/history: XAUS endpoints.
- Gold Market Range: XAUS intraday history.
- USOIL: cTrader source reserved/pending.

## Timeframes
Supported aggregation model:
- 1M, 3M, 5M, 15M, 30M, 1H, 2H, 4H, 1D.
Visible approved timeframe controls currently show:
- 1H, 1M, 5M, 15M, 30M, 2H, 4H, 1D.

## Market Range
Visible liquidity levels:
- DAY HIGH / DAY LOW
- 4H HIGH / 4H LOW
- 1H HIGH / 1H LOW
- 30M HIGH / 30M LOW
- 15M HIGH / 15M LOW

The values are exposed through:
- window.RIZVI_MARKET_RANGE
- event: rizvi:market-range-update

## Liquidity Engine
Current engine detects, heuristically:
- Liquidity sweep
- Liquidity grab
- High/low raid
- Breakout
- Structure qualification

Output:
- window.RIZVI_LIQUIDITY_ENGINE
- event: rizvi:liquidity-update

Important: this is a basic heuristic detector, not yet a validated institutional liquidity model. Sweep/grab distinction and source-bar granularity still require runtime validation.

## Signal Qualification
Current context qualification uses liquidity events to calculate:
- liquidityScore
- patternConfidence
- marketDirection
- alignment
- confirmedSweep
- confirmedBreakout
- multiTimeframe
- status

Output:
- window.RIZVI_SIGNAL_QUALIFICATION
- event: rizvi:signal-qualification-update

Important: this is currently context/qualification logic and should not be presented as proven trading accuracy until validated.

## Trade Range
Current model exposes:
- Entry
- SL
- TP1
- TP2
- TP3

These are signal outputs/informational levels only. The current formula is a placeholder risk/step model and is not yet the final signal engine.

## Current Operational State
- UI shell: approved.
- Live BTC price: connected.
- Live BTC candles: connected.
- Timeframe aggregation: connected.
- Gold spot/history: connected but needs runtime verification.
- Market Range: connected for BTC and Gold.
- Liquidity engine: connected.
- Signal qualification: connected as context.
- USOIL: pending.
- Full end-to-end operational validation: pending.

## Next Operational Work
1. Verify live BTC data on the deployed page.
2. Verify Gold feed and candle parsing at runtime.
3. Verify Market Range values for each timeframe.
4. Verify sweep/grab/breakout events against real bars.
5. Bind validated qualification state to visible SIGNAL / EXECUTION cards.
6. Replace placeholder trade-range/signal logic with the intended validated signal engine.
7. Perform end-to-end QA across BTC and Gold.
8. Add USOIL only after authorized symbol/feed verification.

## Backup / Production Safety
- Git history contains the previous production versions.
- V55 baseline/source archive was preserved before major layout replacement.
- Production should not be treated as operationally validated until the runtime QA steps above pass.
