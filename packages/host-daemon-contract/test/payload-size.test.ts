import { gzipSync } from "node:zlib";
import { turnScope, type ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
  ungroupHostDaemonEvents,
} from "../src/session.js";

interface PayloadSize {
  gzipBytes: number;
  jsonBytes: number;
}

function payloadSize(value: unknown): PayloadSize {
  const json = JSON.stringify(value);
  return {
    gzipBytes: gzipSync(json).byteLength,
    jsonBytes: Buffer.byteLength(json),
  };
}

function event(index: number): ThreadEvent {
  return {
    type: "item/agentMessage/delta",
    threadId: "thr_payload_measurement_123456789",
    providerThreadId: "provider_payload_measurement_123456789",
    scope: turnScope("turn_payload_measurement_123456789"),
    itemId: "item_payload_measurement_123456789",
    delta: `streamed token chunk ${index} `,
  };
}

describe("daemon-to-server event payload sizes", () => {
  it("keeps distinct provider origins and unknown origins separate in a recurring thread", () => {
    const envelopes: HostDaemonEventEnvelope[] = [
      { providerId: "codex", threadId: "thr_a", event: event(1) },
      { providerId: "codex", threadId: "thr_a", event: event(2) },
      { providerId: "claude-code", threadId: "thr_a", event: event(3) },
      { providerId: null, threadId: "thr_a", event: event(4) },
      { providerId: "codex", threadId: "thr_a", event: event(5) },
    ];
    const groups = groupHostDaemonEvents(envelopes);
    expect(
      groups.map(({ providerId, events }) => [providerId, events.length]),
    ).toEqual([
      ["codex", 2],
      ["claude-code", 1],
      [null, 1],
      ["codex", 1],
    ]);
    expect(ungroupHostDaemonEvents(groups)).toEqual(envelopes);
  });

  it("preserves event order when a thread recurs after another thread", () => {
    const envelopes: HostDaemonEventEnvelope[] = [
      { providerId: "codex", threadId: "thr_a", event: event(1) },
      { providerId: "codex", threadId: "thr_b", event: event(2) },
      { providerId: "codex", threadId: "thr_a", event: event(3) },
    ];

    const groups = groupHostDaemonEvents(envelopes);

    expect(groups.map((group) => group.threadId)).toEqual([
      "thr_a",
      "thr_b",
      "thr_a",
    ]);
    expect(ungroupHostDaemonEvents(groups)).toEqual(envelopes);
  });

  it("records legacy-envelope and grouped sizes across representative batches", () => {
    const measurements = [1, 10, 50].map((eventCount) => {
      const events: HostDaemonEventEnvelope[] = Array.from(
        { length: eventCount },
        (_, index) => ({
          providerId: "codex",
          threadId: "thr_payload_measurement_123456789",
          event: event(index),
        }),
      );
      const legacyPayload = {
        sessionId: "session_payload_measurement_123456789",
        events,
      };
      const groupedPayload = {
        sessionId: "session_payload_measurement_123456789",
        eventGroups: groupHostDaemonEvents(events),
      };
      return {
        eventCount,
        legacyEnvelope: payloadSize(legacyPayload),
        grouped: payloadSize(groupedPayload),
      };
    });

    expect(measurements).toEqual([
      {
        eventCount: 1,
        legacyEnvelope: { gzipBytes: 199, jsonBytes: 434 },
        grouped: { gzipBytes: 208, jsonBytes: 442 },
      },
      {
        eventCount: 10,
        legacyEnvelope: { gzipBytes: 252, jsonBytes: 3_764 },
        grouped: { gzipBytes: 253, jsonBytes: 3_070 },
      },
      {
        eventCount: 50,
        legacyEnvelope: { gzipBytes: 416, jsonBytes: 18_604 },
        grouped: { gzipBytes: 416, jsonBytes: 14_790 },
      },
    ]);

    for (const measurement of measurements.slice(1)) {
      expect(measurement.grouped.jsonBytes).toBeLessThan(
        measurement.legacyEnvelope.jsonBytes,
      );
    }
  });
});
