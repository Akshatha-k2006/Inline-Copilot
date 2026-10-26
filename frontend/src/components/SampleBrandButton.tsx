"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { BRAND_DATA_EVENT, SAMPLE_BRAND } from "@/lib/brand-data";

export default function SampleBrandButton() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadSampleBrand() {
    setLoading(true);
    try {
      await api.post("/api/brand/sample", SAMPLE_BRAND);
      window.dispatchEvent(new Event(BRAND_DATA_EVENT));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the sample brand.");
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
        {loading ? "Loading sample..." : "Load sample brand"}
      </button>
      {error && <span className="form-error" role="alert">{error}</span>}
    </div>
  );
}
