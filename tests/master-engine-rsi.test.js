'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const testStorage = new Map();

function runWithWindow(bars) {
  const events = [];
  const window = {
    RIZVI_CURRENT_SYMBOL: 'XAU/USD',
    RIZVI_FEED_STATUS: { ok: true, symbol: 'XAU/USD' },
    RIZVI_AGG_BARS: bars,
    localStorage: { getItem: key => testStorage.has(key) ? testStorage.get(key) : null, setItem: (key, value) => testStorage.set(key, String(value)) },
    dispatchEvent: event => events.push(event),
    addEventListener: () => {}
  };
  const context = {
    window,
    Date,
    Math,
    Number,
    Map,
    Array,
    Object,
    String,
    CustomEvent: function(type, options) { this.type = type; this.detail = options?.detail; },
    setInterval: () => 1
  };
  vm.runInNewContext(fs.readFileSync('rizvi-master-engine.js', 'utf8'), context);
  return window;
}

function runWithCloses(closes) {
  return runWithWindow(closes.map((c, i) => ({
    t: 1_800_000_000 + i * 60,
    o: c, h: c + 1, l: c - 1, c, v: 10
  }))).RIZVI_MASTER_CONFIRMATION;
}

const flat = runWithCloses(Array(30).fill(2300));
assert.equal(flat.rsi, 50, 'flat market RSI should be neutral, not overbought');

const rising = runWithCloses(Array.from({ length: 30 }, (_, i) => 2300 + i));
assert.equal(rising.rsi, 100, 'monotonic gains should yield RSI 100');

const falling = runWithCloses(Array.from({ length: 30 }, (_, i) => 2330 - i));
assert.equal(falling.rsi, 0, 'monotonic losses should yield RSI 0');

const divergenceCloses = [
  ...Array.from({ length: 22 }, (_, i) => 100 + i),
  122, 124, 125, 123, 120, 117, 114, 112
];
const divergence = runWithCloses(divergenceCloses);
assert.equal(divergence.engines.divergence.signal, 'SELL',
  'higher price high with lower RSI should detect bearish divergence');

console.log('Master engine RSI/divergence tests: 4 cases passed.');

const calibrationWindow = runWithWindow(Array.from({ length: 40 }, (_, i) => ({
  t: 1_800_000_000 + i * 60,
  o: 2300 + i, h: 2301 + i, l: 2299 + i, c: 2300 + i, v: 10
})));
const baseTrendWeight = calibrationWindow.RIZVI_MASTER_CONFIRMATION.algoRunReport.baseWeights.trend;
for (let i = 0; i < 5; i++) {
  calibrationWindow.RIZVI_RECORD_TRADE_OUTCOME({
    outcome: 'LOSS',
    direction: 'BUY',
    indicatorSignals: { trend: 'BUY', structure: 'BUY', momentum: 'BUY' }
  });
}
calibrationWindow.RIZVI_RUN_MASTER_CONFIRMATION();
const calibratedReport = calibrationWindow.RIZVI_MASTER_CONFIRMATION.algoRunReport;
assert.equal(calibratedReport.adaptiveCalibration.indicatorOutcomes.trend.n, 5,
  'five recorded outcomes should be tracked for trend');
assert.ok(calibratedReport.weights.trend < baseTrendWeight,
  'trend weight should decrease after five losses aligned with its signal');
assert.equal(Object.values(calibratedReport.weights).reduce((a, b) => a + b, 0), 100,
  'adaptive weights must remain normalized to 100');
assert.equal(calibratedReport.adaptiveCalibration.minSamplesPerIndicator, 5);
assert.ok(testStorage.has('rizvi.v5.engine5.outcomes.v1'),
  'recorded outcomes should persist in local storage');
const reloadedCalibration = runWithWindow(Array.from({ length: 40 }, (_, i) => ({
  t: 1_800_000_000 + i * 60,
  o: 2300 + i, h: 2301 + i, l: 2299 + i, c: 2300 + i, v: 10
})));
assert.equal(reloadedCalibration.RIZVI_MASTER_CONFIRMATION.algoRunReport.adaptiveCalibration.indicatorOutcomes.trend.n, 5,
  'calibration outcomes should survive engine reinitialization');

console.log('Adaptive calibration tests: 4 assertions passed.');


const fvgBars = Array.from({ length: 30 }, (_, i) => ({
  t: 1_800_000_000 + i * 60,
  o: 100, h: 101, l: 99, c: 100, v: 10
}));
fvgBars[21] = { ...fvgBars[21], o: 102, h: 104, l: 102, c: 103 };
fvgBars[22] = { ...fvgBars[22], o: 103, h: 107, l: 105, c: 106 };
fvgBars[23] = { ...fvgBars[23], o: 104, h: 105, l: 102, c: 104 };
fvgBars[24] = { ...fvgBars[24], o: 101, h: 102, l: 100, c: 101 };
fvgBars[25] = { ...fvgBars[25], o: 103, h: 106, l: 102, c: 103 };
const fvgResult = runWithWindow(fvgBars).RIZVI_MASTER_CONFIRMATION;
assert.ok(!(fvgResult.engines.fvg.type === 'BULLISH' &&
  fvgResult.engines.fvg.top === 105 && fvgResult.engines.fvg.bottom === 101),
  'a bullish FVG fully mitigated by a later candle must not remain active');
console.log('FVG mitigation regression test: passed.');

const settingsWindow = runWithWindow(Array.from({ length: 40 }, (_, i) => ({
  t: 1_800_000_000 + i * 60,
  o: 2300 + i, h: 2301 + i, l: 2299 + i, c: 2300 + i, v: 10
})));
assert.equal(settingsWindow.RIZVI_ENGINE5_SETTINGS.minConfidence, 80,
  'Engine 5 default strong qualification confidence should be 80');
assert.equal(settingsWindow.RIZVI_ENGINE5_SETTINGS.weakSignalFloor, 70,
  'Engine 5 should preserve the requested 70 weak-signal floor');
const invalidWeights = settingsWindow.RIZVI_SET_ENGINE5_SETTINGS({
  baseWeights: { trend: 10 }
});
assert.equal(invalidWeights.ok, false, 'partial base weights must be rejected');
const validSettings = settingsWindow.RIZVI_SET_ENGINE5_SETTINGS({
  minConfidence: 82,
  baseWeights: {
    trend: 17, structure: 15, liquidity: 13, momentum: 10, rsi: 8,
    divergence: 7, vwap: 7, volumeProfile: 5, delta: 4,
    candlePattern: 4, candleBias: 5, fvg: 5
  }
});
assert.equal(validSettings.ok, true, 'valid Engine 5 settings should be accepted');
assert.equal(settingsWindow.RIZVI_ENGINE5_SETTINGS.minConfidence, 82,
  'Engine 5 settings API should apply valid changes');
assert.equal(settingsWindow.RIZVI_SET_ENGINE5_SETTINGS({ unknownSetting: 1 }).ok, false,
  'unknown Engine 5 settings must be rejected');
assert.equal(settingsWindow.RIZVI_SET_ENGINE5_SETTINGS({ scoreAlpha: 1.5 }).ok, false,
  'scoreAlpha above 1 must be rejected');
assert.equal(settingsWindow.RIZVI_SET_ENGINE5_SETTINGS({ minConfirmations: 13 }).ok, false,
  'minimum confirmations above core indicator count must be rejected');

console.log('Engine 5 settings tests: 5 assertions passed.');
const trendingBars = Array.from({ length: 40 }, (_, i) => ({
  t: 1_800_000_000 + i * 60,
  o: 2300 + i, h: 2301 + i, l: 2299 + i, c: 2300 + i, v: 10
}));
const trendingResult = runWithWindow(trendingBars).RIZVI_MASTER_CONFIRMATION;
assert.equal(trendingResult.algoRunReport.regime, 'TRENDING',
  'directional price path should classify as trending');
assert.notDeepEqual(trendingResult.algoRunReport.weights, trendingResult.algoRunReport.baseWeights,
  'regime multipliers should adapt indicator weights in trending markets');
assert.equal(Object.values(trendingResult.algoRunReport.weights).reduce((a, b) => a + b, 0), 100,
  'regime-adapted weights must normalize to 100');

const rangingBars = Array.from({ length: 40 }, (_, i) => ({
  t: 1_800_000_000 + i * 60,
  o: 2300 + (i % 2), h: 2302, l: 2298, c: 2300 + (i % 2), v: 10
}));
const rangingResult = runWithWindow(rangingBars).RIZVI_MASTER_CONFIRMATION;
assert.equal(rangingResult.algoRunReport.regime, 'RANGING',
  'low-efficiency sideways prices should classify as ranging');

const volatileBars = Array.from({ length: 40 }, (_, i) => {
  const c = 2300 + i * 0.1;
  const wide = i >= 35 ? 8 : 1;
  return { t: 1_800_000_000 + i * 60, o: c, h: c + wide, l: c - wide, c, v: 10 };
});
const volatileResult = runWithWindow(volatileBars).RIZVI_MASTER_CONFIRMATION;
assert.equal(volatileResult.algoRunReport.regime, 'VOLATILE',
  'sharp recent range expansion should classify as volatile');
console.log('Engine 5 regime-adaptive tests: 5 assertions passed.');
