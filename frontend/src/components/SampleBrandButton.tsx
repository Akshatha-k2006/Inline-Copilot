"use client";

import { useState } from "react";
import { useRole } from "@/lib/role";
import { canManageKnowledge } from "@/lib/workflow";
import { resetDemoWorkspace } from "@/lib/mock-data";

interface SampleBrandButtonProps {
  onLoaded?: () => void;
}

export default function SampleBrandButton({
  onLoaded,
}: SampleBrandButtonProps) {
  const { role } = useRole();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!canManageKnowledge(role)) return null;

  async function loadSampleBrand() {
    if (
      !window.confirm(
        "This resets the fictional demo workspace in this browser. Continue?",
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage("");
    setError("");
    try {
      resetDemoWorkspace(role);
      onLoaded?.();
      setMessage("Sample workspace restored.");
    } catch (cause) {
      setError(
        cause instanceof Error
            ? cause.message
            : "Could not load sample brand data.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sample-brand-action">
      <button
        type="button"
        className="button button-primary"
        onClick={() => void loadSampleBrand()}
        disabled={loading}
      >
        {loading ? "Loading sample brand..." : "Load sample brand"}
      </button>
      {message && <p className="editor-notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
