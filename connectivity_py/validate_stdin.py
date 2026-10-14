import json
import sys
from feed_contract import validate_snapshot

def main():
    try:
        snapshot = json.load(sys.stdin)
        result = validate_snapshot(snapshot)
    except Exception:
        result = {
            "ok": False,
            "reason": "validator_input_error",
            "signal_generation": False,
            "auto_trading": False,
        }
    sys.stdout.write(json.dumps(result, separators=(",", ":"), allow_nan=False))

if __name__ == "__main__":
    main()
