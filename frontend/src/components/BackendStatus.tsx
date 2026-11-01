"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

type Status = "checking" | "available" | "unavailable";

export default function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState("");

  const check = useCallback(() => {
    const controller = new AbortController();
    // Free hosting plans can take a while to start the service after
    // inactivity, so give the health probe enough time for a cold boot.
    const timeoutMs = 30000;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    setStatus("checking");
    setMessage("");

    void api
      .health({ signal: controller.signal })
      .then(() => setStatus("available"))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          setMessage(
            `The service did not respond within ${timeoutMs / 1000} seconds. It may be starting up after inactivity; try again shortly.`,
          );
        } else if (cause instanceof ApiError) {
          setMessage(cause.message);
        } else {
          setMessage("The service could not be reached.");
        }
        setStatus("unavailable");
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => check(), [check]);

  return (
    <span className={`backend-status backend-status-${status}`} role="status">
      <span aria-hidden="true" className="backend-status-dot" />
      {status === "checking"
        ? "Checking live service"
        : status === "available"
          ? "Live service available"
          : "Using local sample data"}
      {status === "unavailable" && (
        <button
          type="button"
          className="backend-status-retry"
          onClick={check}
          title={message}
        ></button>
      )}
    </span>
  );
}
