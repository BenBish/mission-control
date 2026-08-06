import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  getFailureIncidentState,
  isValidTriageStatus,
  upsertFailureIncidentState,
} from "../../db/queries/failure-incidents.js";
import {
  getFailureSummary,
  listFailureGroupEvents,
  listFailureGroups,
  listRecentFailures,
} from "../../db/queries/failures.js";
import type { FailureSignalClass } from "../../lib/failure-fingerprint.js";
import type {
  FailureKind,
  FailureResolution,
  FailureTriageStatus,
  UpdateFailureIncidentInput,
} from "../../types/failures.js";
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

const VALID_SIGNAL = new Set<FailureSignalClass>([
  "actionable",
  "expected",
  "transient",
]);

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

function parseSignalClass(
  value: unknown,
):
  | { ok: true; value: FailureSignalClass | undefined }
  | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (Array.isArray(value)) {
    return { ok: false, error: "signalClass must be a single string" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "signalClass must be a string" };
  }
  const signalClass = value.trim() as FailureSignalClass;
  if (!VALID_SIGNAL.has(signalClass)) {
    return {
      ok: false,
      error: "signalClass must be one of: actionable, expected, transient",
    };
  }
  return { ok: true, value: signalClass };
}

function parseTriageStatus(
  value: unknown,
):
  | { ok: true; value: FailureTriageStatus | undefined }
  | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (Array.isArray(value)) {
    return { ok: false, error: "triageStatus must be a single string" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "triageStatus must be a string" };
  }
  const triageStatus = value.trim();
  if (!isValidTriageStatus(triageStatus)) {
    return {
      ok: false,
      error:
        "triageStatus must be one of: open, acknowledged, snoozed, resolved",
    };
  }
  return { ok: true, value: triageStatus };
}

function parseSourceId(
  value: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (Array.isArray(value)) {
    return { ok: false, error: "sourceId must be a single string" };
  }
  return { ok: true, value: optionalQueryString(value) };
}

function parseFingerprintParam(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function optionalBodyString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value;
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
   * Query: limit, offset, sourceId, kind, resolved, signalClass, triageStatus
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
      const signalResult = parseSignalClass(req.query.signalClass);
      if (!signalResult.ok) {
        res.status(400).json({ success: false, error: signalResult.error });
        return;
      }
      const triageResult = parseTriageStatus(req.query.triageStatus);
      if (!triageResult.ok) {
        res.status(400).json({ success: false, error: triageResult.error });
        return;
      }

      const raw = db.raw();
      const [{ groups, groupTotal, signalQuality }, summary] =
        await Promise.all([
          listFailureGroups(raw, {
            sourceId: sourceResult.value,
            kind: kindResult.value,
            resolved: resolvedResult.value,
            signalClass: signalResult.value,
            triageStatus: triageResult.value,
            limit: limitResult.value,
            offset: offsetResult.value,
          }),
          getFailureSummary(raw, sourceResult.value),
        ]);

      res.json({
        success: true,
        groups,
        groupTotal,
        summary: { ...summary, signalQuality },
      });
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
        const fingerprint = parseFingerprintParam(req.params.fingerprint);
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

  /**
   * Read incident triage state for a fingerprint (may be empty defaults).
   */
  app.get(
    "/api/failures/groups/:fingerprint/incident",
    async (req: Request, res: Response) => {
      try {
        const fingerprint = parseFingerprintParam(req.params.fingerprint);
        if (!fingerprint.trim()) {
          res.status(400).json({
            success: false,
            error: "fingerprint is required",
          });
          return;
        }
        const state = await getFailureIncidentState(db.raw(), fingerprint);
        res.json({
          success: true,
          incident: state ?? {
            fingerprint,
            triageStatus: "open" as const,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[failures] GET /api/failures/groups/:fingerprint/incident failed:",
          message,
        );
        res.status(500).json({
          success: false,
          error: "Failed to load failure incident state",
        });
      }
    },
  );

  /**
   * Update incident triage state (acknowledge / snooze / assign / resolve).
   * Never mutates raw failure source tables.
   */
  app.patch(
    "/api/failures/groups/:fingerprint/incident",
    async (req: Request, res: Response) => {
      try {
        const fingerprint = parseFingerprintParam(req.params.fingerprint);
        if (!fingerprint.trim()) {
          res.status(400).json({
            success: false,
            error: "fingerprint is required",
          });
          return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const input: UpdateFailureIncidentInput = {};

        if (body.triageStatus !== undefined) {
          if (
            typeof body.triageStatus !== "string" ||
            !isValidTriageStatus(body.triageStatus)
          ) {
            res.status(400).json({
              success: false,
              error:
                "triageStatus must be one of: open, acknowledged, snoozed, resolved",
            });
            return;
          }
          input.triageStatus = body.triageStatus;
        }

        if (body.owner !== undefined) {
          if (body.owner !== null && typeof body.owner !== "string") {
            res.status(400).json({
              success: false,
              error: "owner must be a string or null",
            });
            return;
          }
          input.owner = body.owner as string | null;
        }

        if (body.resolutionReason !== undefined) {
          const v = optionalBodyString(body.resolutionReason);
          if (v === undefined && body.resolutionReason !== null) {
            res.status(400).json({
              success: false,
              error: "resolutionReason must be a string or null",
            });
            return;
          }
          input.resolutionReason = v ?? null;
        }

        if (body.runbookUrl !== undefined) {
          const v = optionalBodyString(body.runbookUrl);
          if (v === undefined && body.runbookUrl !== null) {
            res.status(400).json({
              success: false,
              error: "runbookUrl must be a string or null",
            });
            return;
          }
          input.runbookUrl = v ?? null;
        }

        if (body.notes !== undefined) {
          const v = optionalBodyString(body.notes);
          if (v === undefined && body.notes !== null) {
            res.status(400).json({
              success: false,
              error: "notes must be a string or null",
            });
            return;
          }
          input.notes = v ?? null;
        }

        if (body.snoozedUntil !== undefined) {
          const v = optionalBodyString(body.snoozedUntil);
          if (v === undefined && body.snoozedUntil !== null) {
            res.status(400).json({
              success: false,
              error: "snoozedUntil must be an ISO string or null",
            });
            return;
          }
          if (v) {
            const ts = Date.parse(v);
            if (!Number.isFinite(ts)) {
              res.status(400).json({
                success: false,
                error: "snoozedUntil must be a valid ISO timestamp",
              });
              return;
            }
          }
          input.snoozedUntil = v ?? null;
        }

        // Resolve requires a reason so the queue is auditable.
        const nextStatus =
          input.triageStatus ??
          (await getFailureIncidentState(db.raw(), fingerprint))?.triageStatus;
        if (nextStatus === "resolved") {
          const reason =
            input.resolutionReason !== undefined
              ? input.resolutionReason
              : (await getFailureIncidentState(db.raw(), fingerprint))
                  ?.resolutionReason;
          if (!reason || !String(reason).trim()) {
            res.status(400).json({
              success: false,
              error: "resolutionReason is required when resolving an incident",
            });
            return;
          }
        }

        if (
          input.triageStatus === undefined &&
          input.owner === undefined &&
          input.resolutionReason === undefined &&
          input.runbookUrl === undefined &&
          input.notes === undefined &&
          input.snoozedUntil === undefined
        ) {
          res.status(400).json({
            success: false,
            error: "At least one triage field is required",
          });
          return;
        }

        const incident = await upsertFailureIncidentState(
          db.raw(),
          fingerprint,
          input,
        );
        res.json({ success: true, incident });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[failures] PATCH /api/failures/groups/:fingerprint/incident failed:",
          message,
        );
        res.status(500).json({
          success: false,
          error: "Failed to update failure incident state",
        });
      }
    },
  );
}
