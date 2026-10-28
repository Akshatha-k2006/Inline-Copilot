"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useRole } from "@/lib/role";
import { canManageKnowledge } from "@/lib/workflow";

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
        "This replaces the backend sample knowledge records and sample content #1. Continue?",
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage("");
    setError("");
    try {
      const result = await api.seedSample();
      onLoaded?.();
      setMessage(
        `${result.brand} sample data loaded (${result.counts.guidelines} guidelines, ${result.counts.terms} terms, ${result.counts.facts} facts, ${result.counts.assets} assets).`,
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
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
