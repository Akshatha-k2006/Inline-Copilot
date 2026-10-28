"use client";

import { api } from "@/lib/api";
import { useRole } from "@/lib/role";
import { canManageKnowledge } from "@/lib/workflow";

export default function SampleBrandButton() {
  const { role } = useRole();
  if (!canManageKnowledge(role)) return null;

  async function loadSampleBrand() {
    await api.seedSample();
    window.location.reload();
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
