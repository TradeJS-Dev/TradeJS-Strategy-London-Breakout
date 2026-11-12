import assert from "node:assert/strict";
import test from "node:test";
import plugin, { STRATEGY_NAME, strategyEntries } from "../dist/index.js";

test("exports the TradeJS strategy plugin contract", () => {
  assert.equal(strategyEntries.length, 1);
  assert.equal(strategyEntries[0].manifest.name, STRATEGY_NAME);
  assert.deepEqual(
    strategyEntries[0].parseConfig({}),
    strategyEntries[0].defaults,
  );
  assert.throws(
    () => strategyEntries[0].parseConfig({ LONDON_UNKNOWN: 1 }),
    /LondonBreakout\.LONDON_UNKNOWN is not allowed/,
  );
  assert.equal(strategyEntries[0].defaults.BACKTEST_EXECUTION_DELAY_MS, 0);
  assert.throws(
    () =>
      strategyEntries[0].parseConfig({ BACKTEST_EXECUTION_DELAY_MS: 900_000 }),
    /LondonBreakout\.BACKTEST_EXECUTION_DELAY_MS is invalid/,
  );
  assert.deepEqual(plugin.strategyEntries, strategyEntries);
});
