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
  assert.equal(strategyEntries[0].defaults.LONDON_SHORT_GATE, "trained");
  assert.equal(strategyEntries[0].defaults.LONDON_ENTRY_BUFFER_ATR, 0.2);
  assert.equal(strategyEntries[0].defaults.LONG.enable, false);
  assert.equal(strategyEntries[0].defaults.SHORT.enable, true);
  assert.throws(
    () => strategyEntries[0].parseConfig({ LONDON_SHORT_GATE: "unknown" }),
    /LondonBreakout\.LONDON_SHORT_GATE is invalid/,
  );
  assert.throws(
    () =>
      strategyEntries[0].parseConfig({ BACKTEST_EXECUTION_DELAY_MS: 900_000 }),
    /LondonBreakout\.BACKTEST_EXECUTION_DELAY_MS is invalid/,
  );
  assert.deepEqual(plugin.strategyEntries, strategyEntries);
});
