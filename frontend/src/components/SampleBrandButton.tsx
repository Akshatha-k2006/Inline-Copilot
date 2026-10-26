"use client";

import { resetMockKnowledge } from "@/lib/mock-data";

export default function SampleBrandButton() {
  function loadSampleBrand() {
    resetMockKnowledge();
  }

  return (
    <div className="sample-brand-action">
      <button
        type="button"
        className="button button-primary"
        onClick={loadSampleBrand}
      >
        Load sample brand
      </button>
    </div>
  );
}
