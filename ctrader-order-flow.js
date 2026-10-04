const WebSocket = require('ws');

const state = {
  status: 'disabled',
  connected: false,
  authorized: false,
  accountId: null,
  symbols: {},
  levels: new Map(),
  lastDepthAt: 0,
  lastError: null,
  socket: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  accessToken: process.env.CTRADER_ACCESS_TOKEN || '',
  refreshToken: process.env.CTRADER_REFRESH_TOKEN || ''
};

const PT = {
  APP_AUTH_REQ: 2100,
  APP_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  DEPTH_EVENT: 2155,
  SUBSCRIBE_DEPTH_REQ: 2156,
  SUBSCRIBE_DEPTH_RES: 2157,
  GET_ACCOUNTS_BY_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_TOKEN_RES: 2150,
  HEARTBEAT_EVENT: 51
};

function normalized(x) {
  return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function send(ws, payloadType, payload = {}, clientMsgId) {
  ws.send(JSON.stringify({
    clientMsgId: clientMsgId || Math.random().toString(36).slice(2),
    payloadType,
    payload
  }));
}

async function refreshAccessToken() {
  if (!state.refreshToken || !process.env.CTRADER_CLIENT_ID || !process.env.CTRADER_CLIENT_SECRET) {
    return !!state.accessToken;
  }
  const qs = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: state.refreshToken,
    client_id: process.env.CTRADER_CLIENT_ID,
    client_secret: process.env.CTRADER_CLIENT_SECRET
  });
  const r = await fetch('https://openapi.ctrader.com/apps/token?' + qs.toString(), {
    method: 'GET',
    headers: {Accept: 'application/json'}
  });
  const data = await r.json();
  if (!r.ok || data.errorCode) throw new Error(data.description || data.errorCode || 'cTrader token refresh failed');
  state.accessToken = data.accessToken;
  state.refreshToken = data.refreshToken || state.refreshToken;
  return true;
}

function accountIdFromEnv() {
  const n = Number(process.env.CTRADER_ACCOUNT_ID);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function wantedSymbols() {
  return (process.env.CTRADER_SYMBOLS || 'XAUUSD,BTCUSD')
    .split(',')
    .map(normalized)
    .filter(Boolean);
}

function publishDepth(symbolId) {
  const symbolName = state.symbols[symbolId] || String(symbolId);
  const levels = Array.from(state.levels.get(String(symbolId))?.values() || []);
  const compact = levels
    .sort((a,b) => a.price - b.price)
    .slice(-100);
  const payload = compact.map(x => ({
    price: x.price,
    bid: x.bid || 0,
    ask: x.ask || 0,
    size: x.size || 0,
    time: Date.now()
  }));
  if (typeof global.RIZVI_SET_ORDER_FLOW_DEPTH === 'function') {
    global.RIZVI_SET_ORDER_FLOW_DEPTH(payload, 'CTRADER_LEVEL2');
  }
  global.RIZVI_CTRADER_ORDER_FLOW = {
    connected: state.connected && state.authorized,
    source: 'CTRADER_LEVEL2',
    symbol: symbolName,
    symbolId: Number(symbolId),
    levels: payload,
    updatedAt: Date.now(),
    lastDepthAt: state.lastDepthAt
  };
}

function subscribeMatchingSymbols(ws, symbols) {
  const wanted = wantedSymbols();
  for (const s of symbols || []) {
    const id = Number(s.symbolId ?? s.id);
    const name = normalized(s.symbolName || s.name);
    if (!id || !name) continue;
    if (wanted.some(w => name === w || name.includes(w) || w.includes(name))) {
      state.symbols[id] = name;
      if (!state.levels.has(String(id))) state.levels.set(String(id), new Map());
      send(ws, PT.SUBSCRIBE_DEPTH_REQ, {
        ctidTraderAccountId: state.accountId,
        symbolId: [id]
      });
    }
  }
}

function handleDepth(p) {
  const sid = String(p.symbolId);
  if (!state.levels.has(sid)) state.levels.set(sid, new Map());
  const book = state.levels.get(sid);
  for (const q of p.newQuotes || []) {
    const id = String(q.id);
    const priceRaw = q.bid ?? q.ask;
    if (priceRaw == null) continue;
    const price = Number(priceRaw) / 100000;
    const size = Number(q.size || 0) / 100;
    book.set(id, {
      id,
      price,
      size,
      bid: q.bid != null ? size : 0,
      ask: q.ask != null ? size : 0
    });
  }
  for (const id of p.deletedQuotes || []) book.delete(String(id));
  state.lastDepthAt = Date.now();
  publishDepth(sid);
}

function connect() {
  if (!state.accessToken || !process.env.CTRADER_CLIENT_ID || !process.env.CTRADER_CLIENT_SECRET) {
    state.status = 'missing_credentials';
    return;
  }
  clearTimeout(state.reconnectTimer);
  state.status = 'connecting';
  const ws = new WebSocket('wss://live.ctraderapi.com:5036');
  state.socket = ws;

  ws.on('open', () => {
    state.connected = true;
    state.status = 'authenticating';
    send(ws, PT.APP_AUTH_REQ, {
      clientId: process.env.CTRADER_CLIENT_ID,
      clientSecret: process.env.CTRADER_CLIENT_SECRET
    });
  });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const p = m.payload || {};

    if (m.payloadType === PT.APP_AUTH_RES) {
      if (accountIdFromEnv()) {
        state.accountId = accountIdFromEnv();
        send(ws, PT.ACCOUNT_AUTH_REQ, {
          ctidTraderAccountId: state.accountId,
          accessToken: state.accessToken
        });
      } else {
        send(ws, PT.GET_ACCOUNTS_BY_TOKEN_REQ, {accessToken: state.accessToken});
      }
      return;
    }

    if (m.payloadType === PT.GET_ACCOUNTS_BY_TOKEN_RES) {
      const accounts = p.ctidTraderAccount || [];
      const preferred = accounts.find(a => a.isLive === true) || accounts[0];
      if (!preferred?.ctidTraderAccountId) throw new Error('No cTrader account returned for access token');
      state.accountId = Number(preferred.ctidTraderAccountId);
      send(ws, PT.ACCOUNT_AUTH_REQ, {
        ctidTraderAccountId: state.accountId,
        accessToken: state.accessToken
      });
      return;
    }

    if (m.payloadType === PT.ACCOUNT_AUTH_RES) {
      state.authorized = true;
      state.status = 'authorized';
      send(ws, PT.SYMBOLS_LIST_REQ, {
        ctidTraderAccountId: state.accountId,
        includeArchivedSymbols: false
      });
      return;
    }

    if (m.payloadType === PT.SYMBOLS_LIST_RES) {
      subscribeMatchingSymbols(ws, p.symbol || []);
      state.status = Object.keys(state.symbols).length ? 'depth_subscribed' : 'authorized_no_matching_symbols';
      return;
    }

    if (m.payloadType === PT.DEPTH_EVENT) {
      handleDepth(p);
      return;
    }

    if (m.payloadType === PT.HEARTBEAT_EVENT) {
      return;
    }

    if (p.errorCode || m.errorCode) {
      state.lastError = p.description || p.errorCode || m.errorCode;
    }
  });

  state.heartbeatTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) send(ws, PT.HEARTBEAT_EVENT, {}); }, 10000);

  ws.on('close', () => {
    clearInterval(state.heartbeatTimer);
    state.connected = false;
    state.authorized = false;
    state.status = 'reconnecting';
    state.reconnectTimer = setTimeout(connect, 5000);
  });

  ws.on('error', err => {
    state.lastError = err.message;
    state.status = 'error';
  });
}

async function start() {
  try {
    await refreshAccessToken();
    connect();
  } catch (e) {
    state.status = 'token_error';
    state.lastError = e.message;
  }
}

function status() {
  return {
    status: state.status,
    connected: state.connected,
    authorized: state.authorized,
    accountId: state.accountId,
    symbols: state.symbols,
    depthLevels: Array.from(state.levels.entries()).reduce((n,[,v]) => n + v.size, 0),
    lastDepthAt: state.lastDepthAt || null,
    lastError: state.lastError,
    source: 'CTRADER_LEVEL2'
  };
}

module.exports = {start, status, state, refreshAccessToken};