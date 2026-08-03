import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  getFailureSummary,
  listFailureGroupEvents,
  listFailureGroups,
  listRecentFailures,
} from "../../db/queries/failures.js";
import type { FailureKind, FailureResolution } from "../../types/failures.js";
import {
  optionalQueryString,
  parseOptionalNonNegativeInt,
  parseOptionalPositiveInt,
} from "../query.js";

const VALID_KINDS = new Set<FailureKind>([
  "activity",
  "inference_request",
  "runtime_event",
]);

const VALID_RESOLVED = new Set<FailureResolution>(["resolved", "unresolved"]);

function parseKind(
  value: unknown,
): { ok: true; value: FailureKind | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (Array.isArray(value)) {
    return { ok: false, error: "kind must be a single string" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "kind must be a string" };
  }
  const kind = value.trim() as FailureKind;
  if (!VALID_KINDS.has(kind)) {
    return {
      ok: false,
      error: "kind must be one of: activity, inference_request, runtime_event",
    };
  }
  return { ok: true, value: kind };
}

function parseResolved(
  value: unknown,
):
  | { ok: true; value: FailureResolution | undefined }
  | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (Array.isArray(value)) {
    return { ok: false, error: "resolved must be a single string" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "resolved must be a string" };
  }
  const resolved = value.trim() as FailureResolution;
  if (!VALID_RESOLVED.has(resolved)) {
    return {
      ok: false,
      error: "resolved must be one of: resolved, unresolved",
    };
  }
  return { ok: true, value: resolved };
}

function parseSourceId(
  value: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (Array.isArray(value)) {
    return { ok: false, error: "sourceId must be a single string" };
  }
  return { ok: true, value: optionalQueryString(value) };
}

export function registerFailureRoutes(app: Express, db: Database): void {
  /**
   * Raw recent failures (dashboard + legacy). Aggregate summary is independent
   * of the page limit.
   */
  app.get("/api/failures", async (req: Request, res: Response) => {
    try {
      const limitResult = parseOptionalPositiveInt(req.query.limit, "limit");
      if (!limitResult.ok) {
        res.status(400).json({ success: false, error: limitResult.error });
        return;
      }

      const sourceResult = parseSourceId(req.query.sourceId);
      if (!sourceResult.ok) {
        res.status(400).json({ success: false, error: sourceResult.error });
        return;
      }

      const raw = db.raw();
      const [failures, summary] = await Promise.all([
        listRecentFailures(raw, limitResult.value, sourceResult.value),
        getFailureSummary(raw, sourceResult.value),
      ]);
      res.json({ success: true, failures, summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[failures] GET /api/failures failed:", message);
      res.status(500).json({
        success: false,
        error: "Failed to load failures",
      });
    }
  });

  /**
   * Grouped failures for Failure Analysis triage.
   * Query: limit, offset, sourceId, kind, resolved
   */
  app.get("/api/failures/groups", async (req: Request, res: Response) => {
    try {
      const limitResult = parseOptionalPositiveInt(req.query.limit, "limit");
      if (!limitResult.ok) {
        res.status(400).json({ success: false, error: limitResult.error });
        return;
      }
      const offsetResult = parseOptionalNonNegativeInt(
        req.query.offset,
        "offset",
      );
      if (!offsetResult.ok) {
        res.status(400).json({ success: false, error: offsetResult.error });
        return;
      }
      const sourceResult = parseSourceId(req.query.sourceId);
      if (!sourceResult.ok) {
        res.status(400).json({ success: false, error: sourceResult.error });
        return;
      }
      const kindResult = parseKind(req.query.kind);
      if (!kindResult.ok) {
        res.status(400).json({ success: false, error: kindResult.error });
        return;
      }
      const resolvedResult = parseResolved(req.query.resolved);
      if (!resolvedResult.ok) {
        res.status(400).json({ success: false, error: resolvedResult.error });
        return;
      }

      const raw = db.raw();
      const [{ groups, groupTotal }, summary] = await Promise.all([
        listFailureGroups(raw, {
          sourceId: sourceResult.value,
          kind: kindResult.value,
          resolved: resolvedResult.value,
          limit: limitResult.value,
          offset: offsetResult.value,
        }),
        getFailureSummary(raw, sourceResult.value),
      ]);

      res.json({ success: true, groups, groupTotal, summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[failures] GET /api/failures/groups failed:", message);
      res.status(500).json({
        success: false,
        error: "Failed to load failure groups",
      });
    }
  });

  /**
   * Individual events inside a fingerprint group.
   * Path param is URL-encoded fingerprint.
   */
  app.get(
    "/api/failures/groups/:fingerprint/events",
    async (req: Request, res: Response) => {
      try {
        const fingerprint =
          typeof req.params.fingerprint === "string"
            ? decodeURIComponent(req.params.fingerprint)
            : "";
        if (!fingerprint.trim()) {
          res.status(400).json({
            success: false,
            error: "fingerprint is required",
          });
          return;
        }

        const limitResult = parseOptionalPositiveInt(req.query.limit, "limit");
        if (!limitResult.ok) {
          res.status(400).json({ success: false, error: limitResult.error });
          return;
        }
        const offsetResult = parseOptionalNonNegativeInt(
          req.query.offset,
          "offset",
        );
        if (!offsetResult.ok) {
          res.status(400).json({ success: false, error: offsetResult.error });
          return;
        }
        const sourceResult = parseSourceId(req.query.sourceId);
        if (!sourceResult.ok) {
          res.status(400).json({ success: false, error: sourceResult.error });
          return;
        }

        const { events, total } = await listFailureGroupEvents(db.raw(), {
          fingerprint,
          sourceId: sourceResult.value,
          limit: limitResult.value,
          offset: offsetResult.value,
        });

        res.json({
          success: true,
          fingerprint,
          events,
          total,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[failures] GET /api/failures/groups/:fingerprint/events failed:",
          message,
        );
        res.status(500).json({
          success: false,
          error: "Failed to load failure group events",
        });
      }
    },
  );
}
