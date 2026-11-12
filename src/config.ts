import { createStrategyConfigParser } from "@tradejs/strategy-kit/config";
import type { StrategyConfig } from "@tradejs/types";

export interface LondonConfig extends StrategyConfig {
  INTERVAL: "60";
  LONDON_RANGE_MODE: "fixed" | "rolling";
  LONDON_ENTRY_HOUR: number;
  LONDON_MAX_RANGE_ATR: number;
  LONDON_ENTRY_BUFFER_ATR: number;
  LONDON_SHORT_GATE: "trained" | "off";
  LONDON_SHORT_MAX_REL_VOLUME: number;
  LONDON_SHORT_MAX_OVERSHOOT_ATR: number;
  LONDON_STOP_ATR: number;
  LONDON_TARGET_ATR: number;
  MAX_LOSS_VALUE: number;
  RISK_FEE_RATE: number;
  RISK_SLIPPAGE_BPS: number;
  LONG: { enable: boolean; direction: "LONG"; minRiskRatio: number };
  SHORT: { enable: boolean; direction: "SHORT"; minRiskRatio: number };
}

export const defaultConfig: LondonConfig = {
  INTERVAL: "60",
  ENV: "BACKTEST",
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_ENTRY_DELAY_BARS: 1,
  BACKTEST_EXECUTION_DELAY_MS: 0,
  BACKTEST_PRICE_MODE: "open",
  AI_ENABLED: false,
  ML_ENABLED: false,
  LONDON_RANGE_MODE: "fixed",
  LONDON_ENTRY_HOUR: 8,
  LONDON_MAX_RANGE_ATR: 0.5,
  LONDON_ENTRY_BUFFER_ATR: 0.2,
  LONDON_SHORT_GATE: "trained",
  LONDON_SHORT_MAX_REL_VOLUME: 0,
  LONDON_SHORT_MAX_OVERSHOOT_ATR: 0,
  LONDON_STOP_ATR: 0.5,
  LONDON_TARGET_ATR: 1.3,
  MAX_LOSS_VALUE: 10,
  RISK_FEE_RATE: 0.00055,
  RISK_SLIPPAGE_BPS: 2,
  LONG: { enable: false, direction: "LONG", minRiskRatio: 0 },
  SHORT: { enable: true, direction: "SHORT", minRiskRatio: 0 },
};

const parse = createStrategyConfigParser({
  strategyName: "LondonBreakout",
  defaults: defaultConfig,
});

export function parseConfig(input: unknown): LondonConfig {
  const config = parse(input);
  const fail = (key: string): never => {
    throw new Error(`LondonBreakout.${key} is invalid`);
  };
  if (config.INTERVAL !== "60") fail("INTERVAL");
  if (config.BACKTEST_PRICE_MODE !== "open") fail("BACKTEST_PRICE_MODE");
  if (config.BACKTEST_ENTRY_DELAY_BARS !== 1) fail("BACKTEST_ENTRY_DELAY_BARS");
  if (config.BACKTEST_EXECUTION_DELAY_MS !== 0)
    fail("BACKTEST_EXECUTION_DELAY_MS");
  if (!["fixed", "rolling"].includes(config.LONDON_RANGE_MODE))
    fail("LONDON_RANGE_MODE");
  if (
    !Number.isInteger(config.LONDON_ENTRY_HOUR) ||
    config.LONDON_ENTRY_HOUR < 0 ||
    config.LONDON_ENTRY_HOUR > 16
  )
    fail("LONDON_ENTRY_HOUR");

  for (const key of [
    "LONDON_MAX_RANGE_ATR",
    "LONDON_STOP_ATR",
    "LONDON_TARGET_ATR",
    "MAX_LOSS_VALUE",
  ] as const) {
    if (config[key] <= 0) fail(key);
  }
  for (const key of [
    "LONDON_ENTRY_BUFFER_ATR",
    "LONDON_SHORT_MAX_REL_VOLUME",
    "LONDON_SHORT_MAX_OVERSHOOT_ATR",
    "RISK_FEE_RATE",
    "RISK_SLIPPAGE_BPS",
  ] as const) {
    if (config[key] < 0) fail(key);
  }
  if (!["trained", "off"].includes(config.LONDON_SHORT_GATE))
    fail("LONDON_SHORT_GATE");
  if (config.LONG.direction !== "LONG") fail("LONG.direction");
  if (config.SHORT.direction !== "SHORT") fail("SHORT.direction");
  return config;
}
