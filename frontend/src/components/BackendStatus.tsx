"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

type Status = "checking" | "available" | "unavailable";

export default function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState("");

  const check = useCallback(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    setStatus("checking");
    setMessage("");

    void api
      .health({ signal: controller.signal })
      .then(() => setStatus("available"))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          setMessage("The service did not respond within 5 seconds.");
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
        <button type="button" className="backend-status-retry" onClick={check} title={message}>
          Retry
        </button>
      )}
    </span>
  );
}
