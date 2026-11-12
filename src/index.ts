import { defineStrategyPlugin } from "@tradejs/core/config";
import { defaultConfig, parseConfig } from "./config.js";
import { anchorProtectionToFill, createLondonCore } from "./core.js";

export const STRATEGY_NAME = "LondonBreakout";

const plugin = defineStrategyPlugin({
  strategyEntries: [
    {
      defaults: defaultConfig,
      parseConfig,
      manifest: {
        name: STRATEGY_NAME,
        entryRuntimeDefaults: {
          ai: { enabled: false },
          ml: { enabled: false },
        },
        hooks: { afterPlaceOrder: anchorProtectionToFill },
      },
      createCore: createLondonCore,
    },
  ],
});

export const { strategyEntries } = plugin;
export default plugin;
