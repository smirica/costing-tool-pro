import importlib.util
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("metal_quotes", "scripts/metal-quotes.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class QuoteTests(unittest.TestCase):
    def run_quote(self, contract, meta):
        with patch.object(adapter.yf, "Ticker") as ticker:
            ticker.return_value.get_history_metadata.return_value = meta
            result = adapter.quote(contract)
            self.assertFalse(ticker.return_value.history.call_args.kwargs["actions"])
            return result

    def test_units_and_timestamp_objects(self):
        for contract, price in zip(adapter.CONTRACTS, [1200, 2204.6226218488, 5.0]):
            result = self.run_quote(contract, {"regularMarketPrice":price, "regularMarketTime":datetime(2026,9,8,tzinfo=timezone.utc), "currency":"USD"})
            self.assertEqual(result["status"], "available")
            self.assertAlmostEqual(result["pricePerLb"], price/contract[4])
            self.assertTrue(result["quotedAt"].startswith("2026-09-08"))

    def test_invalid_quotes_stay_unavailable(self):
        for price, timestamp, currency in [(0,123,"USD"),(float("nan"),123,"USD"),(20,0,"USD"),(20,123,"EUR")]:
            result = self.run_quote(adapter.CONTRACTS[0], {"regularMarketPrice":price,"regularMarketTime":timestamp,"currency":currency})
            self.assertEqual(result["status"], "unavailable")
            self.assertNotIn("pricePerLb",result)

    def test_failure_is_individual(self):
        with patch.object(adapter.yf, "Ticker", side_effect=RuntimeError("offline")):
            result = adapter.quote(adapter.CONTRACTS[0])
            self.assertEqual(result["status"], "unavailable")


    def test_historical_weekend_uses_prior_close(self):
        import pandas as pd
        data = pd.DataFrame({"Close": [1000.0, 1200.0]}, index=pd.to_datetime(["2026-05-08", "2026-05-11"]))
        with patch.object(adapter.yf, "Ticker") as ticker:
            ticker.return_value.history.return_value = data
            ticker.return_value.get_history_metadata.return_value = {"currency": "USD"}
            rows = adapter.historical_prices(["2026-05-10", "2026-05-20"])
        self.assertEqual(rows[0]["priceDate"], "2026-05-08")
        self.assertEqual(rows[0]["pricePerLb"], 0.5)
        self.assertEqual(rows[1]["status"], "unavailable")

    def test_bad_or_future_history_is_unavailable(self):
        for date in ["2026-02-31", "2099-01-01"]:
            self.assertEqual(adapter.historical_prices([date])[0]["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()

