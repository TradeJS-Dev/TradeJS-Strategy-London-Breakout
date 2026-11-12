import assert from "node:assert/strict";
import test from "node:test";
import { strategyEntries } from "../dist/index.js";

const entry = strategyEntries[0];
const HOUR = 3_600_000;
const DAY = HOUR * 24;
const day = Date.UTC(2026, 3, 1);
const bar = (timestamp, high = 102, low = 98, close = 100) => ({
  timestamp,
  open: close,
  high,
  low,
  close,
  volume: 0,
  turnover: 0,
});
const time = (hour) => day + hour * HOUR;
const warmup = Array.from({ length: 16 * 24 - 1 }, (_, index) =>
  bar(day - 16 * DAY + index * HOUR, 110, 90),
);
const session = Array.from({ length: 9 }, (_, index) => bar(time(index - 1)));
session[0] = bar(time(-1), 104, 96);

const originalConfig = {
  LONDON_ENTRY_BUFFER_ATR: 0.1,
  LONDON_SHORT_GATE: "off",
  LONG: { enable: true },
};

async function core(history = [], overrides = {}) {
  const data = [...history];
  let position = null;
  let current;
  const run = await entry.createCore({
    data,
    config: entry.parseConfig({ ...originalConfig, ...overrides }),
    strategyApi: {
      getCurrentPosition: async () => position,
      createStateController: (_key, initialize) => {
        const state = initialize();
        return { get: () => state };
      },
      skip: (code) => ({ kind: "skip", code }),
      entry: (params) => ({ kind: "entry", ...params }),
      exit: (params) => ({
        kind: "exit",
        code: params.code,
        closePlan: {
          direction: params.direction,
          timestamp: current.timestamp,
          price: current.close,
        },
      }),
    },
  });
  return {
    position(value) {
      position = value;
    },
    append(candle) {
      data.push(candle);
    },
    async next(candle) {
      current = candle;
      data.push(candle);
      return run(candle, candle);
    },
  };
}

test("uses nine closed H1 bars across midnight and freezes daily ATR and levels", async () => {
  const strategy = await core([...warmup, ...session]);
  const signal = await strategy.next(bar(time(8), 150, 90, 107));
  assert.equal(signal.kind, "entry");
  assert.equal(signal.direction, "LONG");
  assert.deepEqual(signal.additionalIndicators.londonBreakout.range, {
    start: time(-1),
    end: time(8),
    high: 104,
    low: 96,
    atr: 20,
    longLevel: 106,
    shortLevel: 94,
  });
  assert.deepEqual(signal.figures.points[0].points, [
    { timestamp: time(9), value: 107 },
  ]);
  assert.equal(signal.figures.lines.length, 2);
  assert.equal(signal.figures.zones[0].start.timestamp, time(-1));
});

test("skips a session with a missing H1 candle or excessive range width", async () => {
  for (const invalidSession of [
    session.filter((_, index) => index !== 5),
    [bar(time(-1), 106, 95), ...session.slice(1)],
  ]) {
    const strategy = await core([...warmup, ...invalidSession]);
    assert.equal(
      (await strategy.next(bar(time(8), 110, 100, 109))).kind,
      "skip",
    );
  }
});

test("a gap in yesterday's candles invalidates its ATR", async () => {
  const history = warmup.filter((candle) => candle.timestamp !== time(-12));
  const strategy = await core([...history, ...session]);
  assert.equal((await strategy.next(bar(time(8), 120, 100, 119))).kind, "skip");
});

test("requires a fresh close beyond the level and mirrors long and short", async () => {
  const long = await core([...warmup, ...session]);
  const short = await core([...warmup, ...session]);
  assert.equal((await long.next(bar(time(8), 110, 98, 106))).kind, "skip");
  assert.equal((await short.next(bar(time(8), 102, 90, 94))).kind, "skip");
  const up = await long.next(bar(time(9), 110, 100, 107));
  const down = await short.next(bar(time(9), 100, 90, 93));
  assert.equal(up.direction, "LONG");
  assert.equal(down.direction, "SHORT");
  assert.equal(up.orderPlan.stopLossPrice, 97);
  assert.equal(down.orderPlan.stopLossPrice, 103);
  assert.equal(up.orderPlan.takeProfits[0].price, 133);
  assert.equal(down.orderPlan.takeProfits[0].price, 67);
});

test("opens the rolling control at 08:00, allows 15:00, and excludes 16:00 UTC", async () => {
  const rolling = await core(
    [
      ...warmup.slice(0, -1),
      bar(time(-2)),
      bar(time(-1)),
      ...session.slice(1, -1),
    ],
    {
      LONDON_RANGE_MODE: "rolling",
    },
  );
  const opening = await rolling.next(bar(time(7), 110, 100, 107));
  assert.equal(opening.kind, "entry");
  assert.equal(
    opening.additionalIndicators.londonBreakout.confirmationTime,
    time(8),
  );

  for (const [confirmationHour, expected] of [
    [15, "entry"],
    [16, "skip"],
  ]) {
    const strategy = await core([...warmup, ...session]);
    for (let hour = 8; hour < confirmationHour - 1; hour++)
      await strategy.next(bar(time(hour)));
    assert.equal(
      (await strategy.next(bar(time(confirmationHour - 1), 110, 100, 108)))
        .kind,
      expected,
    );
  }
});

test("one attempt per UTC day survives a position closing and history replay", async () => {
  const confirmation = bar(time(8), 110, 100, 108);
  const stream = await core([...warmup, ...session]);
  assert.equal((await stream.next(confirmation)).kind, "entry");
  const restored = await core([...warmup, ...session, confirmation]);
  for (const strategy of [stream, restored]) {
    assert.equal((await strategy.next(bar(time(9)))).kind, "skip");
    assert.equal(
      (await strategy.next(bar(time(10), 101, 90, 92))).kind,
      "skip",
    );
  }
});

test("preload, delayed execution, and sequential processing emit identical later signals", async () => {
  const history = [...warmup, ...session];
  const stream = await core();
  for (const candle of history) await stream.next(candle);
  const replay = await core(history);
  const firstBreakout = bar(time(8), 110, 100, 108);
  assert.deepEqual(
    await stream.next(firstBreakout),
    await replay.next(firstBreakout),
  );

  const nextHour = bar(time(9), 111, 100, 108);
  await stream.next(nextHour);
  replay.append(nextHour);
  for (let hour = 10; hour < 33; hour++) {
    const candle =
      hour === 32 ? bar(time(hour), 110, 100, 108) : bar(time(hour));
    const streamed = await stream.next(candle);
    assert.deepEqual(streamed, await replay.next(candle));
    if (hour === 32) assert.equal(streamed.kind, "entry");
  }
});

test("closes an open position at the next 08:00 UTC, using the close timestamp", async () => {
  const strategy = await core([...warmup, ...session]);
  await strategy.next(bar(time(8), 110, 100, 107));
  strategy.position({ qty: 1, direction: "LONG" });
  assert.equal((await strategy.next(bar(time(30)))).kind, "skip");
  const exit = await strategy.next(bar(time(31)));
  assert.equal(exit.code, "LONDON_TIME_EXIT");
  assert.deepEqual(exit.closePlan, {
    timestamp: time(32),
    direction: "LONG",
    price: 100,
  });
});

test("protection is reanchored to the actual fill in both directions", async () => {
  for (const direction of ["LONG", "SHORT"]) {
    const strategy = await core([...warmup, ...session]);
    const confirmation = direction === "LONG" ? 107 : 93;
    const decision = await strategy.next(bar(time(8), 110, 90, confirmation));
    const fill = direction === "LONG" ? 109 : 91;
    const sign = direction === "LONG" ? 1 : -1;
    let protection;
    const result = {
      orderStatus: "completed",
      additionalIndicators: decision.additionalIndicators,
      prices: { currentPrice: fill },
    };
    await entry.manifest.hooks.afterPlaceOrder({
      ctx: {
        symbol: "BTCUSDT",
        strategyConfig: entry.defaults,
        connector: {
          getPosition: async () => ({ direction, price: fill, qty: 1 }),
          setPositionProtection: async (plan) => ((protection = plan), true),
        },
      },
      decision: { entryContext: { direction } },
      order: { result },
    });
    assert.equal(protection.stopLossPrice, fill - sign * 10);
    assert.equal(protection.takeProfits[0].price, fill + sign * 26);
    assert.equal(result.prices.riskRatio, 2.6);
  }
});

test("short volume uses the preceding 20 H1, excludes the signal, and rejects equality", async () => {
  const history = [...warmup, ...session].map((candle) => ({
    ...candle,
    volume: candle.timestamp < time(-1) ? 200 : 100,
  }));
  const mean = (11 * 200 + 9 * 100) / 20;
  const config = { LONDON_SHORT_MAX_REL_VOLUME: 1.5 };
  const reject = await core(history, config);
  assert.equal(
    (await reject.next({ ...bar(time(8), 101, 92, 93), volume: mean * 1.5 }))
      .kind,
    "skip",
  );

  const accept = await core(history, config);
  assert.equal(
    (
      await accept.next({
        ...bar(time(8), 101, 92, 93),
        volume: mean * 1.5 - 1,
      })
    ).kind,
    "entry",
  );

  const noVolume = await core([...warmup, ...session], config);
  assert.equal((await noVolume.next(bar(time(8), 101, 92, 93))).kind, "skip");
});

test("overshoot rejects equality and leaves a fresh short cross eligible", async () => {
  const config = { LONDON_SHORT_MAX_OVERSHOOT_ATR: 0.1 };
  const strategy = await core([...warmup, ...session], config);
  // The level is 94, daily ATR is 20, so a close at 92 is exactly 0.10 ATR below it.
  assert.equal((await strategy.next(bar(time(8), 101, 91, 92))).kind, "skip");
  assert.equal((await strategy.next(bar(time(9), 93, 90, 93))).kind, "skip");
  assert.equal((await strategy.next(bar(time(10)))).kind, "skip");
  assert.equal(
    (await strategy.next(bar(time(11), 101, 92, 93))).direction,
    "SHORT",
  );
});

test("both filters are required for shorts and leave longs unaffected", async () => {
  const history = [...warmup, ...session].map((candle) => ({
    ...candle,
    volume: 100,
  }));
  const config = {
    LONDON_SHORT_MAX_REL_VOLUME: 1.5,
    LONDON_SHORT_MAX_OVERSHOOT_ATR: 0.1,
  };
  for (const [close, volume, kind] of [
    [92, 100, "skip"],
    [93, 151, "skip"],
    [93, 149, "entry"],
  ]) {
    const strategy = await core(history, config);
    assert.equal(
      (await strategy.next({ ...bar(time(8), 102, 90, close), volume })).kind,
      kind,
    );
  }
  const long = await core(history, config);
  assert.equal(
    (await long.next({ ...bar(time(8), 111, 99, 108), volume: 500 })).direction,
    "LONG",
  );
});

test("default candidate reproduces the frozen short score and rejects an early signal", async () => {
  const history = [...warmup, ...session].map((candle) => ({
    ...candle,
    volume: 100,
  }));
  const shortSignal = (hour, volume = 100) => ({
    ...bar(time(hour), 101, 90, 91),
    open: 100,
    volume,
  });
  const late = history.concat(
    Array.from({ length: 4 }, (_, i) => ({ ...bar(time(8 + i)), volume: 100 })),
  );

  const accepted = await core(late, entry.defaults);
  const decision = await accepted.next(shortSignal(12));
  assert.equal(decision.kind, "entry");
  assert.equal(decision.direction, "SHORT");
  assert.equal(
    decision.additionalIndicators.londonBreakout.range.shortLevel,
    92,
  );
  assert.ok(
    Math.abs(
      decision.additionalIndicators.londonBreakout.shortGateScore -
        1.6882466284066582,
    ) < 1e-12,
  );

  const busy = await core(late, entry.defaults);
  assert.equal(
    (await busy.next(shortSignal(12, 800))).code,
    "LONDON_SHORT_GATE_REJECT",
  );

  const early = await core(history, entry.defaults);
  const first = shortSignal(8);
  assert.equal((await early.next(first)).code, "LONDON_SHORT_GATE_REJECT");
  const restored = await core([...history, first], entry.defaults);
  for (const strategy of [early, restored]) {
    for (let hour = 9; hour < 12; hour++) {
      await strategy.next({ ...bar(time(hour)), volume: 100 });
    }
    assert.equal(
      (await strategy.next(shortSignal(12))).code,
      "LONDON_NO_BREAKOUT",
    );
  }
});

test("default candidate requires valid prior volume and disables longs", async () => {
  const history = [...warmup, ...session];
  const missing = await core(history, entry.defaults);
  assert.equal(
    (await missing.next({ ...bar(time(8), 101, 90, 91), volume: 100 })).code,
    "LONDON_SHORT_GATE_REJECT",
  );
  const long = await core(history, entry.defaults);
  assert.equal((await long.next(bar(time(8), 112, 98, 109))).kind, "skip");
});
