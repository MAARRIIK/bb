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
  it("keeps distinct provider generations and unknown origins separate in a recurring thread", () => {
    const envelopes: HostDaemonEventEnvelope[] = [
      {
        source: { providerId: "codex", providerSessionId: null },
        threadId: "thr_a",
        event: event(1),
      },
      {
        source: { providerId: "codex", providerSessionId: null },
        threadId: "thr_a",
        event: event(2),
      },
      {
        source: { providerId: "codex", providerSessionId: "next-generation" },
        threadId: "thr_a",
        event: event(3),
      },
      {
        source: { providerId: "claude-code", providerSessionId: null },
        threadId: "thr_a",
        event: event(4),
      },
      { source: null, threadId: "thr_a", event: event(5) },
      {
        source: { providerId: "codex", providerSessionId: null },
        threadId: "thr_a",
        event: event(6),
      },
    ];
    const groups = groupHostDaemonEvents(envelopes);
    expect(groups.map(({ source, events }) => [source, events.length])).toEqual(
      [
        [{ providerId: "codex", providerSessionId: null }, 2],
        [{ providerId: "codex", providerSessionId: "next-generation" }, 1],
        [{ providerId: "claude-code", providerSessionId: null }, 1],
        [null, 1],
        [{ providerId: "codex", providerSessionId: null }, 1],
      ],
    );
    expect(ungroupHostDaemonEvents(groups)).toEqual(envelopes);
  });

  it("preserves event order when a thread recurs after another thread", () => {
    const envelopes: HostDaemonEventEnvelope[] = [
      {
        source: { providerId: "codex", providerSessionId: null },
        threadId: "thr_a",
        event: event(1),
      },
      {
        source: { providerId: "codex", providerSessionId: null },
        threadId: "thr_b",
        event: event(2),
      },
      {
        source: { providerId: "codex", providerSessionId: null },
        threadId: "thr_a",
        event: event(3),
      },
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
          source: { providerId: "codex", providerSessionId: null },
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
        legacyEnvelope: { gzipBytes: 220, jsonBytes: 470 },
        grouped: { gzipBytes: 224, jsonBytes: 478 },
      },
      {
        eventCount: 10,
        legacyEnvelope: { gzipBytes: 272, jsonBytes: 4_124 },
        grouped: { gzipBytes: 271, jsonBytes: 3_106 },
      },
      {
        eventCount: 50,
        legacyEnvelope: { gzipBytes: 438, jsonBytes: 20_404 },
        grouped: { gzipBytes: 434, jsonBytes: 14_826 },
      },
    ]);

    for (const measurement of measurements.slice(1)) {
      expect(measurement.grouped.jsonBytes).toBeLessThan(
        measurement.legacyEnvelope.jsonBytes,
      );
    }
  });
});
