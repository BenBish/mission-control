import type { Express, Request, Response } from "express";
import { activityEvents } from "../services/ingest-service.js";
import type { Activity } from "../../types/activity.js";

/**
 * Server-Sent Events endpoint for real-time activity updates.
 *
 * The old version scoped clients by ?profile=<id>. Profiles are gone —
 * there's a single global broadcast now; the frontend filters client-side
 * by sourceId the same way it filters the REST list endpoints.
 */
export function registerStreamRoutes(app: Express): void {
  const clients = new Set<Response>();

  const onActivityCreated = (activity: Activity) => {
    const message = `event: activity\ndata: ${JSON.stringify(activity)}\n\n`;
    for (const client of clients) {
      if (!client.writableEnded) {
        client.write(message);
      } else {
        clients.delete(client);
      }
    }
  };
  activityEvents.on("activity:created", onActivityCreated);

  app.get("/api/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    clients.add(res);
    console.log(`[SSE] Client connected. Active clients: ${clients.size}`);

    res.write(
      `event: system\ndata: ${JSON.stringify({ type: "connected" })}\n\n`,
    );

    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(
          `event: system\ndata: ${JSON.stringify({ type: "heartbeat" })}\n\n`,
        );
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    req.on("close", () => {
      clearInterval(heartbeatInterval);
      clients.delete(res);
      console.log(`[SSE] Client disconnected. Active clients: ${clients.size}`);
    });
  });
}
