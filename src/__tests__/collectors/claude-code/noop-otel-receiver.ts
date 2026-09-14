import type {
  OtelReceiverLike,
  SessionCostDelta,
  ApiRequestCost,
} from "../../../collectors/claude-code/otel-receiver.js";

/**
 * Shared test fake — a collector test that isn't specifically exercising
 * OTel correlation should inject this instead of a real OtelReceiver so it
 * never binds a real socket (which would also collide across parallel test
 * files sharing the same default port).
 */
export class NoopOtelReceiver implements OtelReceiverLike {
  async start(): Promise<number | null> {
    return null;
  }
  async stop(): Promise<void> {}
  getRequestCost(_requestId: string): ApiRequestCost | undefined {
    return undefined;
  }
  consumeRequestCost(_requestId: string): void {}
  drainSessionCostDeltas(): SessionCostDelta[] {
    return [];
  }
}

/** Seedable fake for tests that exercise OTel correlation without a real socket. */
export class FakeOtelReceiver implements OtelReceiverLike {
  private requestCosts = new Map<string, ApiRequestCost>();
  private sessionDeltas: SessionCostDelta[] = [];

  seedRequestCost(cost: ApiRequestCost): void {
    this.requestCosts.set(cost.requestId, cost);
  }

  seedSessionCostDelta(delta: SessionCostDelta): void {
    this.sessionDeltas.push(delta);
  }

  async start(): Promise<number | null> {
    return null;
  }
  async stop(): Promise<void> {}

  getRequestCost(requestId: string): ApiRequestCost | undefined {
    return this.requestCosts.get(requestId);
  }
  consumeRequestCost(requestId: string): void {
    this.requestCosts.delete(requestId);
  }
  drainSessionCostDeltas(): SessionCostDelta[] {
    const out = this.sessionDeltas;
    this.sessionDeltas = [];
    return out;
  }
}
