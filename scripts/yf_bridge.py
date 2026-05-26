#!/usr/bin/env python3
"""TradeSimple yfinance bridge — JSON in (stdin) or argv, JSON out (stdout)."""

from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from typing import Any

warnings.filterwarnings("ignore")

RANGE_MAP = {
    "1d": ("1d", "5m"),
    "1w": ("5d", "30m"),
    "1m": ("1mo", "1d"),
    "3m": ("3mo", "1d"),
    "6m": ("6mo", "1d"),
    "1y": ("1y", "1d"),
    "5y": ("5y", "1wk"),
}


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, default=str))
    sys.stdout.flush()


def _fail(message: str, **extra: Any) -> None:
    _emit({"ok": False, "error": message, **extra})
    sys.exit(0)


def _iso_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
        return None


def _num(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out:  # NaN
        return None
    return out


def fetch_quote(symbol: str) -> dict[str, Any]:
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    fast = getattr(ticker, "fast_info", None) or {}
    price = _num(fast.get("last_price") or fast.get("lastPrice") or fast.get("regularMarketPrice"))
    prev = _num(
        fast.get("previous_close")
        or fast.get("previousClose")
        or fast.get("regular_market_previous_close")
        or fast.get("regularMarketPreviousClose")
    )
    ts = None

    if price is None or price <= 0:
        hist = ticker.history(period="5d", interval="1d", auto_adjust=False)
        if hist is None or hist.empty:
            raise ValueError("no_quote_data")
        row = hist.iloc[-1]
        price = _num(row.get("Close"))
        if price is None or price <= 0:
            raise ValueError("invalid_price")
        if prev is None and len(hist) > 1:
            prev = _num(hist.iloc[-2].get("Close"))
        ts = _iso_timestamp(hist.index[-1])
        high = _num(row.get("High"))
        low = _num(row.get("Low"))
        open_ = _num(row.get("Open"))
    else:
        high = _num(fast.get("day_high") or fast.get("dayHigh") or fast.get("regularMarketDayHigh"))
        low = _num(fast.get("day_low") or fast.get("dayLow") or fast.get("regularMarketDayLow"))
        open_ = _num(fast.get("open") or fast.get("regularMarketOpen"))
        ts = _iso_timestamp(fast.get("last_volume") or fast.get("regularMarketTime"))

    change = (price - prev) if price is not None and prev is not None and prev > 0 else None
    pct = (change / prev * 100.0) if change is not None and prev else None

    return {
        "symbol": symbol.upper(),
        "price": price,
        "change": change,
        "pct": pct,
        "changePercent": pct,
        "high": high,
        "low": low,
        "open": open_,
        "prevClose": prev,
        "previousClose": prev,
        "timestamp": ts or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "yfinance",
    }


def fetch_history(symbol: str, range_key: str) -> list[dict[str, Any]]:
    import yfinance as yf

    period, interval = RANGE_MAP.get(range_key, ("6mo", "1d"))
    hist = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
    if hist is None or hist.empty:
        return []

    intraday = range_key in ("1d", "1w")
    points: list[dict[str, Any]] = []
    for idx, row in hist.iterrows():
        close = _num(row.get("Close"))
        if close is None or close <= 0:
            continue
        iso = _iso_timestamp(idx) or ""
        date = iso[:16] if intraday and len(iso) >= 16 else iso[:10]
        points.append(
            {
                "date": date,
                "open": _num(row.get("Open")) or close,
                "high": _num(row.get("High")) or close,
                "low": _num(row.get("Low")) or close,
                "close": close,
                "volume": int(_num(row.get("Volume")) or 0),
            }
        )
    return points


def handle_request(req: dict[str, Any]) -> None:
    mode = str(req.get("mode") or "").strip().lower()
    symbol = str(req.get("symbol") or "").strip().upper()
    if not symbol or not symbol.replace(".", "").isalnum():
        _fail("invalid_symbol")
    range_key = str(req.get("range") or "6m").strip().lower()

    try:
        if mode == "quote":
            quote = fetch_quote(symbol)
            _emit({"ok": True, "mode": "quote", "symbol": symbol, "quote": quote})
            return
        if mode == "history":
            points = fetch_history(symbol, range_key)
            if not points:
                _fail("no_history", symbol=symbol, range=range_key)
            _emit({"ok": True, "mode": "history", "symbol": symbol, "range": range_key, "points": points})
            return
        _fail("invalid_mode", mode=mode)
    except Exception as exc:  # noqa: BLE001 — bridge must never traceback to Node
        _fail(str(exc) or "yfinance_error", symbol=symbol, mode=mode)


def parse_argv() -> dict[str, Any] | None:
    args = sys.argv[1:]
    if len(args) < 2:
        return None
    mode = args[0].strip().lower()
    symbol = args[1].strip().upper()
    range_key = args[2].strip().lower() if len(args) > 2 else "6m"
    return {"mode": mode, "symbol": symbol, "range": range_key}


def main() -> None:
    req = parse_argv()
    if req is None and not sys.stdin.isatty():
        try:
            raw = sys.stdin.read()
            req = json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError as exc:
            _fail(f"invalid_json: {exc}")
    if not req:
        _fail("usage", hint="yf_bridge.py quote SYMBOL | history SYMBOL [range] | stdin JSON")
    handle_request(req)


if __name__ == "__main__":
    main()
