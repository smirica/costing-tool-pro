"""One-shot Yahoo futures quote adapter. stdout is JSON; no price cache."""
import json
import math
import sys
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import yfinance as yf

CONTRACTS = [("steel", "Steel HRC", "HRC=F", "short ton", 2000),
             ("aluminum", "Aluminum", "ALI=F", "metric ton", 2204.6226218488),
             ("copper", "Copper", "HG=F", "lb", 1)]

def quote(contract):
    key, label, symbol, unit, pounds = contract
    result = dict(id=key, label=label, symbol=symbol, unit=unit, currency="USD")
    try:
        ticker = yf.Ticker(symbol)
        ticker.history(period="5d", interval="1d", auto_adjust=False, actions=False, timeout=12)
        meta = ticker.get_history_metadata()
        price = float(meta.get("regularMarketPrice", 0))
        quote_time = meta.get("regularMarketTime", 0)
        timestamp = quote_time.timestamp() if hasattr(quote_time, "timestamp") else float(quote_time)
        if meta.get("currency") != "USD" or not math.isfinite(price) or price <= 0 or not math.isfinite(timestamp) or timestamp <= 0:
            raise ValueError("No valid USD quote with timestamp")
        result.update(price=price, pricePerLb=price / pounds,
                      quotedAt=datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
                      delayed=True, status="available")
    except Exception:
        result.update(status="unavailable", error="Yahoo quote unavailable. Try Reload later.")
    return result


def historical_prices(dates):
    """Daily HRC closes at or before each supplier date, within seven days."""
    results = [dict(requestedDate=d, status="unavailable",
                    error="No HRC close within seven days before the supplier date.") for d in dates]
    if not dates:
        return results
    try:
        parsed = [datetime.strptime(d, "%Y-%m-%d").date() for d in dates]
        if any(d > datetime.now(timezone.utc).date() or d.year < 2000 for d in parsed):
            return results
        ticker = yf.Ticker("HRC=F")
        data = ticker.history(start=(min(parsed)-timedelta(days=7)).isoformat(),
                              end=(max(parsed)+timedelta(days=1)).isoformat(),
                              interval="1d", auto_adjust=False, actions=False, timeout=15)
        meta = ticker.get_history_metadata()
        if meta.get("currency") != "USD":
            return results
        for result, target in zip(results, parsed):
            eligible = [(stamp.date(), float(value)) for stamp,value in data["Close"].items()
                        if target-timedelta(days=7) <= stamp.date() <= target
                        and math.isfinite(float(value)) and float(value) > 0]
            if eligible:
                day, price = max(eligible, key=lambda pair: pair[0])
                result.update(status="available", priceDate=day.isoformat(), pricePerLb=price/2000)
                result.pop("error", None)
    except Exception:
        pass
    return results

if __name__ == "__main__":
    dates = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
    if not isinstance(dates,list) or len(dates)>40 or any(not isinstance(d,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",d) for d in dates):
        raise ValueError("Invalid supplier dates")
    with ThreadPoolExecutor(max_workers=4) as pool:
        history = pool.submit(historical_prices, dates)
        quotes = list(pool.map(quote, CONTRACTS))
        history = history.result()
    print(json.dumps(dict(source="Yahoo Finance via yfinance", fetchedAt=datetime.now(timezone.utc).isoformat(),
                          quotes=quotes, steelHistory=history), allow_nan=False))
