/**
 * Display helpers for Consumption Direct API Spend forecast / burn-rate.
 *
 * Unreliable or uncomputable rates must never render as a bare $0.00 —
 * that reads as a real estimate even when the card disclaims itself (BSH-139).
 */

export type SpendRateDisplay = {
  available: boolean;
  /** Primary figure: dollar amount or em dash. */
  primary: string;
};

export function formatForecastMonthEnd(opts: {
  reliable: boolean;
  pointUsd: number;
}): SpendRateDisplay {
  if (!opts.reliable) return { available: false, primary: "—" };
  return { available: true, primary: `$${opts.pointUsd.toFixed(2)}` };
}

export function formatBurnRate(opts: {
  reliable: boolean;
  usdPerDay: number;
}): SpendRateDisplay {
  if (!opts.reliable) return { available: false, primary: "—" };
  return { available: true, primary: `$${opts.usdPerDay.toFixed(2)}` };
}

/**
 * Caption under an unavailable forecast. Keeps the existing sync disclaimers
 * and uses "Insufficient data" when the rate is missing for other reasons
 * (no complete days, low confidence).
 */
export function forecastUnavailableCaption(opts: {
  reliable: boolean;
  hasNoSyncData: boolean;
  hasStaleOrErrorSync: boolean;
}): string | null {
  if (opts.reliable) return null;
  if (opts.hasNoSyncData) return "No sync history — do not trust this figure";
  if (opts.hasStaleOrErrorSync)
    return "Stale/failed sync — do not trust this figure";
  return "Insufficient data";
}
