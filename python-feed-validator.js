'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 1500;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * Optional, fail-closed adapter for the isolated Python feed contract.
 * It is intentionally not wired into the production signal path yet.
 * Enable only after the deployment image is proven to contain Python 3.
 */
function validateWithPython(snapshot, options = {}) {
  const enabled = options.enabled ?? process.env.RIZVI_PYTHON_VALIDATOR_ENABLED === 'true';
  if (!enabled) {
    return Promise.resolve({ ok: false, reason: 'python_validator_disabled', signal_generation: false, auto_trading: false });
  }

  const timeoutMs = Number(options.timeoutMs ?? process.env.RIZVI_PYTHON_VALIDATOR_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
    return Promise.resolve({ ok: false, reason: 'invalid_validator_timeout', signal_generation: false, auto_trading: false });
  }

  let payload;
  try {
    payload = JSON.stringify(snapshot);
  } catch {
    return Promise.resolve({ ok: false, reason: 'snapshot_not_serializable', signal_generation: false, auto_trading: false });
  }
  if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > MAX_INPUT_BYTES) {
    return Promise.resolve({ ok: false, reason: 'snapshot_payload_too_large', signal_generation: false, auto_trading: false });
  }

  const python = options.pythonPath || process.env.RIZVI_PYTHON_EXECUTABLE || 'python3';
  const script = path.join(__dirname, 'connectivity_py', 'validate_stdin.py');
  const run = options.execFile || execFile;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = run(python, [script], {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }, (error, stdout) => {
      if (error) {
        const reason = error.killed || error.code === 'ETIMEDOUT'
          ? 'python_validator_timeout'
          : error.code === 'ENOENT'
            ? 'python_runtime_unavailable'
            : 'python_validator_execution_failed';
        finish({ ok: false, reason, signal_generation: false, auto_trading: false });
        return;
      }
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        finish({ ok: false, reason: 'python_validator_invalid_json', signal_generation: false, auto_trading: false });
        return;
      }
      if (!result || typeof result !== 'object' || Array.isArray(result) ||
          typeof result.ok !== 'boolean' || result.signal_generation !== false ||
          result.auto_trading !== false || (result.ok && !Array.isArray(result.bars))) {
        finish({ ok: false, reason: 'python_validator_invalid_response', signal_generation: false, auto_trading: false });
        return;
      }
      finish(result);
    });
    if (child && child.stdin && typeof child.stdin.end === 'function') {
      child.stdin.end(payload);
    } else if (run === execFile) {
      finish({ ok: false, reason: 'python_validator_stdin_unavailable', signal_generation: false, auto_trading: false });
    }
  });
}

module.exports = { validateWithPython, DEFAULT_TIMEOUT_MS, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES };
