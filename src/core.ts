import { buildTradeEconomics } from "@tradejs/strategy-kit/risk";
import type {
  CreateStrategyCore,
  Direction,
  StrategyManifest,
} from "@tradejs/types";
import type { LondonConfig } from "./config.js";
import { HOUR, initialLondonState, processClosedHour } from "./engine.js";
import { buildLondonFigures } from "./figures.js";

function protection(
  price: number,
  direction: Direction,
  atr: number,
  config: LondonConfig,
) {
  const sign = direction === "LONG" ? 1 : -1;
  return {
    stopLossPrice: price - sign * config.LONDON_STOP_ATR * atr,
    takeProfits: [
      { price: price + sign * config.LONDON_TARGET_ATR * atr, rate: 1 },
    ],
  };
}

export const createLondonCore: CreateStrategyCore<LondonConfig> = async ({
  config,
  data,
  strategyApi,
}) => {
  const initialLength = data.length;
  const state = strategyApi.createStateController(
    "LondonBreakout",
    () => ({
      engine: initialLondonState(),
      nextDataIndex: 0,
      exitTime: null as number | null,
    }),
    { sharedReplay: false },
  );

  return async (candle) => {
    const runtime = state.get();
    // Delayed execution can append a candle without calling this core.
    while (runtime.nextDataIndex < data.length) {
      const index = runtime.nextDataIndex;
      const previous = data[index];
      if (previous.timestamp >= candle.timestamp) break;
      processClosedHour(
        runtime.engine,
        config,
        previous,
        index < initialLength,
      );
      runtime.nextDataIndex++;
    }

    const position = await strategyApi.getCurrentPosition();
    const signal = processClosedHour(
      runtime.engine,
      config,
      candle,
      !position?.qty,
    );
    const confirmationTime = candle.timestamp + HOUR;
    if (position?.qty) {
      if (runtime.exitTime === null || confirmationTime >= runtime.exitTime) {
        const decision = await strategyApi.exit({
          direction: position.direction,
          code:
            runtime.exitTime === null
              ? "LONDON_UNKNOWN_POSITION_AGE"
              : "LONDON_TIME_EXIT",
        });
        if (decision.kind === "exit") {
          decision.closePlan.timestamp = confirmationTime;
        }
        return decision;
      }
      return strategyApi.skip("LONDON_POSITION_OPEN");
    }

    runtime.exitTime = null;
    if (!signal) return strategyApi.skip("LONDON_NO_BREAKOUT");

    const direction = signal.direction;
    const plan = protection(signal.close, direction, signal.range.atr, config);
    const target = plan.takeProfits[0].price;
    if (plan.stopLossPrice <= 0 || target <= 0)
      return strategyApi.skip("LONDON_INVALID_PROTECTION");

    const economics = buildTradeEconomics({
      entryPrice: signal.close,
      stopLossPrice: plan.stopLossPrice,
      takeProfitPrice: target,
      feeRate: config.RISK_FEE_RATE,
      slippageBps: config.RISK_SLIPPAGE_BPS,
    });
    const qty = config.MAX_LOSS_VALUE / economics.lossPerUnit;
    if (
      !Number.isFinite(qty) ||
      qty <= 0 ||
      economics.netRiskRatio < config[direction].minRiskRatio
    )
      return strategyApi.skip("LONDON_INSUFFICIENT_RISK_RATIO");

    runtime.exitTime = signal.exitTime;
    return strategyApi.entry({
      code: "LONDON_BREAKOUT",
      direction,
      signalId: `LondonBreakout:${signal.confirmationTime}:${direction}`,
      figures: buildLondonFigures(signal),
      additionalIndicators: { londonBreakout: signal },
      orderPlan: { ...plan, qty },
    });
  };
};

export const anchorProtectionToFill: NonNullable<
  NonNullable<StrategyManifest["hooks"]>["afterPlaceOrder"]
> = async ({ ctx, decision, order }) => {
  if (
    typeof order.result === "string" ||
    order.result.orderStatus !== "completed"
  )
    return;
  const signal = order.result;
  const setup = signal.additionalIndicators?.londonBreakout as
    BreakoutSignalData | undefined;
  if (!setup || !Number.isFinite(setup.range.atr) || setup.range.atr <= 0) {
    throw new Error("LondonBreakout is missing the signal ATR");
  }

  const { connector, symbol } = ctx;
  const position = await connector.getPosition(symbol);
  if (
    !position?.qty ||
    position.direction !== decision.entryContext.direction ||
    !Number.isFinite(position.price)
  ) {
    throw new Error("LondonBreakout is missing the filled position");
  }

  const levels = protection(
    position.price,
    position.direction,
    setup.range.atr,
    ctx.strategyConfig as LondonConfig,
  );
  const params = {
    ...levels,
    symbol,
    direction: position.direction,
    qty: position.qty,
  };
  const applied = connector.setPositionProtection
    ? await connector.setPositionProtection(params)
    : (await connector.setStopLoss(params)) &&
      (await connector.setTakeProfits(params));
  if (!applied)
    throw new Error("LondonBreakout could not anchor protection to the fill");

  signal.prices.stopLossPrice = levels.stopLossPrice;
  signal.prices.takeProfitPrice = levels.takeProfits[0].price;
  signal.prices.riskRatio =
    Math.abs(levels.takeProfits[0].price - position.price) /
    Math.abs(position.price - levels.stopLossPrice);
};

type BreakoutSignalData = { range: { atr: number } };
