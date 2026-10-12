# Engine 5 Super — Locked Specification (Rizvi Dashboard V5)

Status: SPECIFICATION LOCKED — documentation only.
Branch: fix/gold-feed-alignment-step1
Activation phrase from user: "Engine 5 Super".
Do not implement, alter current Engine 5 code/weights/layout, merge, deploy, or enable Auto Trading until the user explicitly asks to start Engine 5 Super.

## Purpose
Engine 5 Super is intended to be a regime-adaptive calibration and final-confirmation layer, not merely a weight-adjustment feature. Existing Engine 5 settings and the 12 base indicator weights remain unchanged while this specification is locked.

## Planned safeguards to audit/implement only after explicit activation
1. Regime confidence and transition confirmation; avoid aggressive weight shifts when regime is uncertain.
2. Data-quality gate for stale, missing, mismatched, or inconsistent OHLC/feed data; use WAIT and do not learn from invalid data.
3. Audit outcome-calibration correctness. Evaluate indicator direction against actual trade outcome/forward price movement, not just the WIN/LOSS label; exclude invalid or ambiguous outcomes.
4. Minimum sample sizes and bounded weight changes; use out-of-sample / walk-forward validation to reduce overfitting.
5. Correlation-aware weighting so highly correlated indicators are not counted as independent confirmations.
6. Gold/XAU session-aware calibration, only after the basic validation gates pass.
7. Automatic-weight-change limits, rollback/fallback behavior, and an auditable log of regime, weights, active indicators, data freshness, and decision reason.
8. Safe fallback to WAIT when data or regime confidence is inadequate.
9. Validate all regimes with synthetic regression cases first, then forward-test on verified live XAU data. Do not claim production validation from synthetic tests.
10. Keep order-flow/delta unavailable unless genuine, fresh, symbol-matched cTrader Level-2 data is verified. Never fabricate these inputs.

## Acceptance criteria
- Existing settings API rejects invalid values and weights remain normalized to 100.
- Tests cover TRENDING, RANGING, VOLATILE, UNKNOWN/low-confidence, stale/missing feed, regime transitions, calibration persistence, incorrect/invalid outcome labels, bounded adaptation, and rollback.
- Walk-forward/holdout results are reported separately from in-sample results.
- Signal frequency and signal quality are measured separately; no win-rate or profitability claim without sufficient out-of-sample evidence.
- Auto Trading remains OFF.
- No production merge/deploy without explicit user approval.

## Important interpretation
The 95 compatibility value is a confluence score, not a 95% probability of winning. Safeguards are expected to reduce the number of displayed/tradable setups in many conditions; whether precision/win rate improves must be measured, not assumed.
