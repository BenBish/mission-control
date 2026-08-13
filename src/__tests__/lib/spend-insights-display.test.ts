import { describe, expect, test } from "bun:test";
import {
  forecastUnavailableCaption,
  formatBurnRate,
  formatForecastMonthEnd,
} from "../../lib/spend-insights-display.js";

describe("formatForecastMonthEnd", () => {
  test("reliable forecast shows the dollar amount, including a true zero", () => {
    expect(formatForecastMonthEnd({ reliable: true, pointUsd: 12.5 })).toEqual({
      available: true,
      primary: "$12.50",
    });
    expect(formatForecastMonthEnd({ reliable: true, pointUsd: 0 })).toEqual({
      available: true,
      primary: "$0.00",
    });
  });

  test("unreliable forecast never shows a dollar figure", () => {
    expect(formatForecastMonthEnd({ reliable: false, pointUsd: 0 })).toEqual({
      available: false,
      primary: "—",
    });
    expect(formatForecastMonthEnd({ reliable: false, pointUsd: 4.2 })).toEqual({
      available: false,
      primary: "—",
    });
  });
});

describe("formatBurnRate", () => {
  test("reliable burn shows the per-day dollar amount", () => {
    expect(formatBurnRate({ reliable: true, usdPerDay: 0.67 })).toEqual({
      available: true,
      primary: "$0.67",
    });
  });

  test("unreliable burn never shows $0.00/day", () => {
    expect(formatBurnRate({ reliable: false, usdPerDay: 0 })).toEqual({
      available: false,
      primary: "—",
    });
  });
});

describe("forecastUnavailableCaption", () => {
  test("reliable forecast has no unavailable caption", () => {
    expect(
      forecastUnavailableCaption({
        reliable: true,
        hasNoSyncData: false,
        hasStaleOrErrorSync: false,
      }),
    ).toBeNull();
  });

  test("keeps existing sync disclaimers", () => {
    expect(
      forecastUnavailableCaption({
        reliable: false,
        hasNoSyncData: true,
        hasStaleOrErrorSync: false,
      }),
    ).toBe("No sync history — do not trust this figure");
    expect(
      forecastUnavailableCaption({
        reliable: false,
        hasNoSyncData: false,
        hasStaleOrErrorSync: true,
      }),
    ).toBe("Stale/failed sync — do not trust this figure");
  });

  test("insufficient complete days / low confidence uses a non-numeric reason", () => {
    expect(
      forecastUnavailableCaption({
        reliable: false,
        hasNoSyncData: false,
        hasStaleOrErrorSync: false,
      }),
    ).toBe("Insufficient data");
  });
});
