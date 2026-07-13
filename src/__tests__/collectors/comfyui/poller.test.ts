/**
 * ComfyUI response-parsing tests against real captured /queue and
 * /history shapes from a live box (2026-07-13) — two real submitted
 * workflows (a 1-step SDXL Turbo job and an 8-step one), not synthetic
 * examples. See src/collectors/comfyui/poller.ts's file header.
 */

import { describe, test, expect } from "bun:test";
import {
  nodeCount,
  outputCount,
  workflowHash,
  deriveStatus,
  buildPayloadFromHistory,
  buildPayloadFromQueue,
  type QueuedJob,
} from "../../../collectors/comfyui/poller.js";

// Real prompt dict from the first captured job (1-step SDXL Turbo).
const REAL_PROMPT = {
  "1": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "sd_xl_turbo_1.0_fp16.safetensors" },
  },
  "2": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a red cube", clip: ["1", 1] },
  },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
  "4": {
    class_type: "EmptyLatentImage",
    inputs: { width: 512, height: 512, batch_size: 1 },
  },
  "5": {
    class_type: "KSampler",
    inputs: {
      seed: 42,
      steps: 1,
      cfg: 1.0,
      sampler_name: "euler_ancestral",
      scheduler: "normal",
      denoise: 1.0,
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
    },
  },
  "6": {
    class_type: "VAEDecode",
    inputs: { samples: ["5", 0], vae: ["1", 2] },
  },
  "7": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "mc_verify_test", images: ["6", 0] },
  },
};

// Real /history/<prompt_id> entry, first captured job — exact shape.
const REAL_HISTORY_SUCCESS = {
  prompt: [
    0,
    "c2b9337c-6b23-46cd-ae24-9328bcafdeb1",
    REAL_PROMPT,
    { create_time: 1783912766416 },
    ["7"],
  ] as [number, string, typeof REAL_PROMPT, { create_time?: number }, string[]],
  outputs: {
    "7": {
      images: [
        {
          filename: "mc_verify_test_00001_.png",
          subfolder: "",
          type: "output",
        },
      ],
    },
  },
  status: {
    status_str: "success",
    completed: true,
    messages: [
      [
        "execution_start",
        {
          prompt_id: "c2b9337c-6b23-46cd-ae24-9328bcafdeb1",
          timestamp: 1783912766416,
        },
      ],
      [
        "execution_cached",
        {
          nodes: [],
          prompt_id: "c2b9337c-6b23-46cd-ae24-9328bcafdeb1",
          timestamp: 1783912766418,
        },
      ],
      [
        "execution_success",
        {
          prompt_id: "c2b9337c-6b23-46cd-ae24-9328bcafdeb1",
          timestamp: 1783912772731,
        },
      ],
    ] as Array<
      [string, { prompt_id?: string; timestamp?: number; nodes?: string[] }]
    >,
  },
};

describe("nodeCount", () => {
  test("counts real 7-node workflow correctly", () => {
    expect(nodeCount(REAL_PROMPT)).toBe(7);
  });
});

describe("outputCount", () => {
  test("counts real single-image output", () => {
    expect(outputCount(REAL_HISTORY_SUCCESS.outputs)).toBe(1);
  });

  test("returns 0 for undefined outputs (job not yet complete)", () => {
    expect(outputCount(undefined)).toBe(0);
  });

  test("sums images across multiple output nodes", () => {
    expect(
      outputCount({
        a: { images: [{ filename: "1.png", subfolder: "", type: "output" }] },
        b: {
          images: [
            { filename: "2.png", subfolder: "", type: "output" },
            { filename: "3.png", subfolder: "", type: "output" },
          ],
        },
      }),
    ).toBe(3);
  });
});

describe("workflowHash", () => {
  test("is stable for the same prompt dict", () => {
    expect(workflowHash(REAL_PROMPT)).toBe(workflowHash(REAL_PROMPT));
  });

  test("differs for a different prompt dict", () => {
    const changed = {
      ...REAL_PROMPT,
      "2": { class_type: "CLIPTextEncode", inputs: { text: "a blue sphere" } },
    };
    expect(workflowHash(REAL_PROMPT)).not.toBe(workflowHash(changed));
  });
});

describe("deriveStatus", () => {
  test("real successful job: extracts start/success timestamps exactly", () => {
    const result = deriveStatus(REAL_HISTORY_SUCCESS as never);
    expect(result.status).toBe("success");
    expect(result.observedStartedAt).toBe(
      new Date(1783912766416).toISOString(),
    );
    expect(result.observedCompletedAt).toBe(
      new Date(1783912772731).toISOString(),
    );
  });

  test("real second captured job (8-step, different timing)", () => {
    const entry = {
      ...REAL_HISTORY_SUCCESS,
      status: {
        status_str: "success",
        completed: true,
        messages: [
          [
            "execution_start",
            {
              prompt_id: "13360404-2344-46d9-a1b3-6550872990be",
              timestamp: 1783912800499,
            },
          ],
          [
            "execution_success",
            {
              prompt_id: "13360404-2344-46d9-a1b3-6550872990be",
              timestamp: 1783912804763,
            },
          ],
        ] as Array<[string, { prompt_id?: string; timestamp?: number }]>,
      },
    };
    const result = deriveStatus(entry as never);
    expect(result.status).toBe("success");
    expect(result.observedCompletedAt).toBe(
      new Date(1783912804763).toISOString(),
    );
  });

  test("unrecognized status_str degrades to 'error', not a crash", () => {
    const entry = {
      ...REAL_HISTORY_SUCCESS,
      status: {
        status_str: "something_unexpected",
        completed: true,
        messages: [],
      },
    };
    const result = deriveStatus(entry as never);
    expect(result.status).toBe("error");
  });

  test("execution_interrupted message maps to 'interrupted'", () => {
    const entry = {
      ...REAL_HISTORY_SUCCESS,
      status: {
        status_str: "error",
        completed: true,
        messages: [
          ["execution_start", { timestamp: 1000 }],
          ["execution_interrupted", { timestamp: 2000 }],
        ] as Array<[string, { timestamp?: number }]>,
      },
    };
    const result = deriveStatus(entry as never);
    expect(result.status).toBe("interrupted");
  });
});

describe("buildPayloadFromHistory", () => {
  test("real successful job maps to a complete GenerationJobPayload", () => {
    const payload = buildPayloadFromHistory(
      "c2b9337c-6b23-46cd-ae24-9328bcafdeb1",
      REAL_HISTORY_SUCCESS as never,
      "2026-07-13T00:00:00.000Z",
    );
    expect(payload.externalId).toBe("c2b9337c-6b23-46cd-ae24-9328bcafdeb1");
    expect(payload.status).toBe("success");
    expect(payload.firstSeenAt).toBe("2026-07-13T00:00:00.000Z");
    expect(payload.nodeCount).toBe(7);
    expect(payload.outputCount).toBe(1);
    expect(payload.workflowHash).toBeTruthy();
  });
});

describe("buildPayloadFromQueue", () => {
  test("running job maps to status:'running'", () => {
    const job: QueuedJob = {
      promptId: "abc",
      prompt: REAL_PROMPT,
      state: "running",
    };
    const payload = buildPayloadFromQueue(job, "2026-07-13T00:00:00.000Z");
    expect(payload.status).toBe("running");
    expect(payload.nodeCount).toBe(7);
  });

  test("pending job maps to status:'queued'", () => {
    const job: QueuedJob = {
      promptId: "abc",
      prompt: REAL_PROMPT,
      state: "pending",
    };
    const payload = buildPayloadFromQueue(job, "2026-07-13T00:00:00.000Z");
    expect(payload.status).toBe("queued");
  });
});
