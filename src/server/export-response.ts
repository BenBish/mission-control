import type { Response } from "express";
import type { ExportFormat } from "../lib/consumption-export.js";

export function sendConsumptionExport(
  res: Response,
  opts: {
    format: ExportFormat;
    filename: string;
    csv: string;
    jsonBody: unknown;
  },
): void {
  const safeName = opts.filename.replace(/[\r\n"]/g, "");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  if (opts.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.status(200).send(opts.csv);
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).send(JSON.stringify(opts.jsonBody, null, 2));
}
