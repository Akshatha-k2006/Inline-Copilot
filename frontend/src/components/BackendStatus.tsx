"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, api } from "@/lib/api";

type State = "checking" | "ok" | "down";

/** Pings /api/health so you can see at a glance that the backend is reachable. */
export default function BackendStatus() {
  const [state, setState] = useState<State>("checking");
  const [detail, setDetail] = useState("");

  const check = useCallback(async () => {
    setState("checking");
    setDetail("");
    try {
      await api.health();
      setState("ok");
    } catch (err) {
      setState("down");
      setDetail(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <div className="status-card" role="status" aria-live="polite">
      <span className={`dot dot-${state}`} aria-hidden="true" />
      <div className="status-text">
        <strong>
          {state === "checking" && "Checking the server…"}
          {state === "ok" && "Server connected"}
          {state === "down" && "Server not reachable"}
        </strong>
        <span className="muted">{API_URL}</span>
        {state === "down" && <span className="muted">{detail}</span>}
      </div>
      {state === "down" && (
        <button type="button" className="button" onClick={check}>
          Try again
        </button>
      )}
    </div>
  );
}
