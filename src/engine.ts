import type { Candle, Direction } from "@tradejs/types";
import type { LondonConfig } from "./config.js";
import { scoreLondonShort } from "./shortGate.js";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const RANGE_HOURS = 9;
const ENTRY_HOURS = 8;
const ATR_DAYS = 14;
const RELATIVE_VOLUME_HOURS = 20;

export type HourBar = Pick<
  Candle,
  "timestamp" | "high" | "low" | "close" | "volume"
>;

interface DailyBar extends HourBar {
  count: number;
}

export interface SessionRange {
  start: number;
  end: number;
  high: number;
  low: number;
  atr: number;
  longLevel: number;
  shortLevel: number;
}

export interface BreakoutSignal {
  direction: Direction;
  confirmationTime: number;
  close: number;
  exitTime: number;
  range: SessionRange;
  shortGateScore?: number | null;
}

export interface LondonState {
  hours: HourBar[];
  daily: DailyBar | null;
  previousDailyClose: number | null;
  trueRangeCount: number;
  atr: number;
  dayAtr: number | null;
  fixedRange: SessionRange | null;
  attemptedDay: number | null;
}

export function initialLondonState(): LondonState {
  return {
    hours: [],
    daily: null,
    previousDailyClose: null,
    trueRangeCount: 0,
    atr: 0,
    dayAtr: null,
    fixedRange: null,
    attemptedDay: null,
  };
}

function updateDaily(state: LondonState, bar: HourBar, closeTime: number) {
  const day = Math.floor(bar.timestamp / DAY) * DAY;
  if (!state.daily || state.daily.timestamp !== day) {
    if (state.daily || bar.timestamp !== day) {
      state.previousDailyClose = null;
      state.trueRangeCount = 0;
      state.atr = 0;
      state.dayAtr = null;
    }
    state.daily = { ...bar, timestamp: day, count: 0 };
  }

  const daily = state.daily;
  daily.high = Math.max(daily.high, bar.high);
  daily.low = Math.min(daily.low, bar.low);
  daily.close = bar.close;
  daily.count++;

  if (closeTime !== day + DAY) return;
  state.daily = null;
  state.fixedRange = null;
  state.dayAtr = null;
  if (daily.count !== 24) {
    state.previousDailyClose = null;
    state.trueRangeCount = 0;
    state.atr = 0;
    return;
  }
  const previousClose = state.previousDailyClose;
  state.previousDailyClose = daily.close;
  if (previousClose === null) return;

  const trueRange = Math.max(
    daily.high - daily.low,
    Math.abs(daily.high - previousClose),
    Math.abs(daily.low - previousClose),
  );
  state.trueRangeCount = Math.min(ATR_DAYS, state.trueRangeCount + 1);
  state.atr += (trueRange - state.atr) / state.trueRangeCount;
  if (state.trueRangeCount === ATR_DAYS && state.atr > 0) {
    state.dayAtr = state.atr;
  }
}

function makeRange(
  hours: readonly HourBar[],
  end: number,
  atr: number | null,
  config: LondonConfig,
): SessionRange | null {
  const start = end - RANGE_HOURS * HOUR;
  if (
    atr === null ||
    hours.length !== RANGE_HOURS ||
    hours.some((bar, index) => bar.timestamp !== start + index * HOUR)
  ) {
    return null;
  }
  const high = Math.max(...hours.map((bar) => bar.high));
  const low = Math.min(...hours.map((bar) => bar.low));
  if (high - low > config.LONDON_MAX_RANGE_ATR * atr) return null;
  const buffer = config.LONDON_ENTRY_BUFFER_ATR * atr;
  return {
    start,
    end,
    high,
    low,
    atr,
    longLevel: high + buffer,
    shortLevel: low - buffer,
  };
}

function relativeVolume(hours: readonly HourBar[], signal: HourBar) {
  const preceding = hours.slice(-RELATIVE_VOLUME_HOURS - 1, -1);
  if (
    preceding.length !== RELATIVE_VOLUME_HOURS ||
    !Number.isFinite(signal.volume) ||
    signal.volume < 0
  ) {
    return null;
  }
  const firstTimestamp = signal.timestamp - RELATIVE_VOLUME_HOURS * HOUR;
  let total = 0;
  for (const [index, hour] of preceding.entries()) {
    if (
      hour.timestamp !== firstTimestamp + index * HOUR ||
      !Number.isFinite(hour.volume) ||
      hour.volume < 0
    ) {
      return null;
    }
    total += hour.volume;
  }
  return total > 0 && Number.isFinite(total)
    ? signal.volume / (total / RELATIVE_VOLUME_HOURS)
    : null;
}

export function processClosedHour(
  state: LondonState,
  config: LondonConfig,
  bar: HourBar & Pick<Candle, "open">,
  canEnter = true,
): BreakoutSignal | null {
  if (
    !Number.isSafeInteger(bar.timestamp) ||
    bar.timestamp % HOUR !== 0 ||
    ![bar.high, bar.low, bar.close].every(Number.isFinite) ||
    bar.low <= 0 ||
    bar.close < bar.low ||
    bar.close > bar.high
  ) {
    throw new Error("LondonBreakout requires an aligned, closed H1 candle");
  }

  const previous = state.hours.at(-1);
  if (previous && previous.timestamp >= bar.timestamp) return null;
  if (
    previous &&
    Math.floor(previous.timestamp / DAY) + 1 < Math.floor(bar.timestamp / DAY)
  ) {
    state.daily = null;
    state.previousDailyClose = null;
    state.trueRangeCount = 0;
    state.atr = 0;
    state.dayAtr = null;
  }

  const confirmationTime = bar.timestamp + HOUR;
  const day = Math.floor(confirmationTime / DAY) * DAY;
  const sessionStart = day + config.LONDON_ENTRY_HOUR * HOUR;
  updateDaily(state, bar, confirmationTime);

  const rollingRange =
    config.LONDON_RANGE_MODE === "rolling" &&
    confirmationTime >= sessionStart &&
    confirmationTime < sessionStart + ENTRY_HOURS * HOUR
      ? makeRange(
          state.hours.slice(-RANGE_HOURS),
          bar.timestamp,
          state.dayAtr,
          config,
        )
      : null;
  state.hours.push({
    timestamp: bar.timestamp,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  });
  const retainedHours =
    config.LONDON_SHORT_GATE === "trained" ||
    config.LONDON_SHORT_MAX_REL_VOLUME > 0
      ? RELATIVE_VOLUME_HOURS + 1
      : RANGE_HOURS;
  if (state.hours.length > retainedHours) state.hours.shift();

  if (
    config.LONDON_RANGE_MODE === "fixed" &&
    confirmationTime === sessionStart
  ) {
    state.fixedRange = makeRange(
      state.hours.slice(-RANGE_HOURS),
      sessionStart,
      state.dayAtr,
      config,
    );
  }
  const range =
    config.LONDON_RANGE_MODE === "fixed"
      ? state.fixedRange?.end === sessionStart
        ? state.fixedRange
        : null
      : rollingRange;

  if (
    !canEnter ||
    !range ||
    state.attemptedDay === day ||
    confirmationTime < sessionStart ||
    confirmationTime >= sessionStart + ENTRY_HOURS * HOUR ||
    previous?.timestamp !== bar.timestamp - HOUR
  ) {
    return null;
  }

  const direction =
    config.LONG.enable &&
    previous.close <= range.longLevel &&
    bar.close > range.longLevel
      ? "LONG"
      : config.SHORT.enable &&
          previous.close >= range.shortLevel &&
          bar.close < range.shortLevel
        ? "SHORT"
        : null;
  if (!direction) return null;
  let shortGateScore: number | null | undefined;
  if (direction === "SHORT") {
    const overshootAtr = (range.shortLevel - bar.close) / range.atr;
    const maxOvershoot = config.LONDON_SHORT_MAX_OVERSHOOT_ATR;
    if (maxOvershoot > 0 && overshootAtr >= maxOvershoot) return null;

    const trainedGate = config.LONDON_SHORT_GATE === "trained";
    const maxVolume = config.LONDON_SHORT_MAX_REL_VOLUME;
    const volume =
      trainedGate || maxVolume > 0 ? relativeVolume(state.hours, bar) : null;
    if (maxVolume > 0 && (volume === null || volume >= maxVolume)) return null;

    if (trainedGate) {
      shortGateScore = scoreLondonShort(
        volume,
        overshootAtr,
        (range.high - range.low) / range.atr,
        (bar.open - bar.close) / range.atr,
        confirmationTime,
      );
    }
  }

  state.attemptedDay = day;
  return {
    direction,
    confirmationTime,
    close: bar.close,
    exitTime: day + DAY + 8 * HOUR,
    range,
    ...(shortGateScore === undefined ? {} : { shortGateScore }),
  };
}
