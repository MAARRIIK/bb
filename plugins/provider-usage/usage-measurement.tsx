import { useEffect, useState } from "react";
import type { UsageProvider } from "./usage-schema.js";
import { formatUsageTimestamp } from "./usage-format.js";

export function UsageMeasurementDetails({
  account,
  unavailable,
}: {
  account: UsageProvider;
  unavailable: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const stale =
    account.observedAt !== null &&
    (unavailable ||
      account.refreshError !== undefined ||
      now - account.observedAt > 5 * 60_000);
  return (
    <div className="space-y-0.5">
      <p title={account.source.pluginId}>
        Source: {account.source.displayName}
      </p>
      <p>
        {account.observedAt === null ? (
          "Measurement time not reported."
        ) : (
          <>
            {stale ? "Last measurement (stale): " : "Last measurement: "}
            <time dateTime={new Date(account.observedAt).toISOString()}>
              {formatUsageTimestamp(account.observedAt)}
            </time>
          </>
        )}
      </p>
    </div>
  );
}
