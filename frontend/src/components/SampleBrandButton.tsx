"use client";

import { resetMockKnowledge } from "@/lib/mock-data";
import { useRole } from "@/lib/role";
import { canManageKnowledge } from "@/lib/workflow";

export default function SampleBrandButton() {
  const { role } = useRole();
  if (!canManageKnowledge(role)) return null;

  function loadSampleBrand() {
    resetMockKnowledge(role);
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
