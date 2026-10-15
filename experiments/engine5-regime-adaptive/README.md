# Engine 5 regime-adaptive comparison (isolated prototype)

**Safety:** experiment only. Not imported by the dashboard; no production Engine 5 settings or logic are changed; no deployment or trade execution.

- `engine5_adaptive.py`: regime-conditioned bounded weighting.
- `engine5_adaptive.js`: JavaScript mirror for parity testing.

Regimes: TRENDING_UP, TRENDING_DOWN, RANGING, HIGH_VOLATILITY, MIXED. Regime confidence fades regime-specific multipliers toward neutral when the classifier is uncertain. Weights are normalized over available features; missing inputs are excluded, not treated as neutral evidence. A quality gate returns WAIT when fewer than three inputs exist, confidence is below 55, or directional agreement is weak.

**Important limitations:** confidence is decision strength, not calibrated win probability. This prototype takes a regime label from upstream; it does not detect regimes from OHLC bars, learn weights from trade outcomes, or prove predictive performance. It has not been evaluated on historical XAUUSD trades.

Before production consideration: run Python/JS parity tests on frozen inputs; compare against the current fixed-weight baseline on chronological walk-forward XAUUSD data including spread/slippage, drawdown, trade count, expectancy, precision, and calibration; report metrics by regime and on a holdout period. Keep Auto Trading OFF and production locked pending explicit approval.
