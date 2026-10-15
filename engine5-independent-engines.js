/**
 * Diagnostic evaluator that partitions indicator inputs into named domains.
 * These domain summaries are NOT independent engines and must never count toward
 * the independent Engine 1-4 alignment gate.
 * No network, DOM, timers, order execution, or production side effects.
 */
'use strict';

const DOMAINS = Object.freeze([
  { engine: 'ENGINE_1', name: 'Trend & Momentum', keys: ['ema9/21', 'rsi-14', 'trend(5)', 'macd', 'momentum', 'stochastic', 'cci', 'roc'] },
  { engine: 'ENGINE_2', name: 'Structure & Price Action', keys: ['marketstructure', 'structureprediction', 'candlepatterns/priceaction', 'fairvaluegap(fvg)', 'support&resistance', 'priceaction', 'pattern'] },
  { engine: 'ENGINE_3', name: 'Volume & Liquidity', keys: ['vwapfilter', 'volumeprofile', 'liquiditypools/sweeps', 'deltabuysell', 'orderflow', 'delta'] },
  { engine: 'ENGINE_4', name: 'Divergence & Market Context', keys: ['bullish/bearishdivergence', 'dxyinverse-correlationfilter', 'high-impactusnewsfilter', 'volatilityregimefilter', 'atr(14)', 'tradingsessions', 'dayhigh/daylow'] }
]);
const unavailable = /UNAVAILABLE|WAITING|INSUFFICIENT|NO_REAL_VOLUME|NO_REAL_ORDER_FLOW|NO_TRADE_SIDE_VOLUME|NOT_ATTACHED|BLOCKED|STALE|ERROR|MISSING/;
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9/()+&-]/g, '');
const direction = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(-1, Math.min(1, value));
  const s = String(value || '').trim().toUpperCase();
  if (['BUY', 'BULLISH', 'UP', 'LONG'].includes(s)) return 1;
  if (['SELL', 'BEARISH', 'DOWN', 'SHORT'].includes(s)) return -1;
  if (['WAIT', 'NEUTRAL', 'FLAT'].includes(s)) return 0;
  return null;
};
function matches(name, keys) {
  const key = normalize(name);
  return keys.some(k => key === normalize(k) || key.includes(normalize(k)));
}
function evaluateDomainDiagnostics(domain, components) {
  const selected = Object.entries(components || {}).filter(([name]) => matches(name, domain.keys));
  const usable = selected.filter(([, item]) => item && typeof item === 'object' &&
    !unavailable.test(String(item.status || '')) &&
    (item.score == null || (Number.isFinite(Number(item.score)) && Number(item.score) >= 0 && Number(item.score) <= 100)));
  const votes = usable.map(([name, item]) => {
    let bias = direction(item.direction ?? item.action ?? item.signal);
    if (bias == null) bias = direction(item.bias);
    const score = item.score == null ? null : Number(item.score);
    return { name, bias, score };
  }).filter(x => x.bias != null);
  const directional = votes.filter(x => x.bias !== 0);
  const mean = directional.length ? directional.reduce((sum, x) => sum + x.bias, 0) / directional.length : 0;
  const action = mean >= 0.2 ? 'BUY' : mean <= -0.2 ? 'SELL' : 'WAIT';
  const reportAvailable = usable.length >= 2 && directional.length >= 2;
  return {
    domainId: domain.engine,
    name: domain.name,
    independent: false,
    reportAvailable,
    action: reportAvailable ? action : 'NOT_REPORTED',
    score: reportAvailable ? Math.round((50 + mean * 50) * 100) / 100 : null,
    directionalInputs: directional.length,
    componentCount: usable.length,
    inputs: usable.map(([name]) => name)
  };
}
function evaluateIndicatorDomainDiagnostics(components = {}) {
  const diagnostics = DOMAINS.map(domain => evaluateDomainDiagnostics(domain, components));
  return {
    independent: false,
    method: 'INDICATOR_DOMAIN_DIAGNOSTICS_ONLY_V1',
    engines: [],
    diagnostics
  };
}
module.exports = { DOMAINS, evaluateDomainDiagnostics, evaluateIndicatorDomainDiagnostics };
