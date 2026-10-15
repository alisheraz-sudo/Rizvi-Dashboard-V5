/**
 * Isolated shadow-only entry point. Rejects stale/misaligned production
 * snapshots before invoking the adaptive evaluator. Never places orders.
 */
'use strict';
const { evaluate } = require('./engine5-max-regime-adaptive');
const { buildInput, validateSnapshot } = require('./engine5-production-adapter');

function evaluateSnapshot(snapshot = {}, options = {}) {
  const validation = validateSnapshot(snapshot, options);
  const input = buildInput(snapshot);
  if (!validation.valid) {
    return {
      engine: 'ENGINE5_MAX_REGIME_ADAPTIVE_JS',
      mode: 'SHADOW_CANDIDATE',
      symbol: input.symbol,
      timeframe: input.timeframe,
      action: 'WAIT',
      qualified: false,
      confidence: 0,
      blockers: ['SNAPSHOT_VALIDATION_FAILED', ...validation.blockers],
      snapshotValidation: validation,
      sourceMeta: input.sourceMeta,
      autoTrading: false
    };
  }
  const result = evaluate({
    ...input,
    qualifiedRunCount: options.qualifiedRunCount || 0
  });
  return { ...result, timeframe: input.timeframe, snapshotValidation: validation,
    sourceMeta: input.sourceMeta, autoTrading: false };
}

module.exports = { evaluateSnapshot };
