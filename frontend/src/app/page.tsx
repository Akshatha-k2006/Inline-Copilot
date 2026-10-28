"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SampleBrandButton from "@/components/SampleBrandButton";
import { ApiError, api } from "@/lib/api";
import { loadBrandData } from "@/lib/knowledge";
import { useRole } from "@/lib/role";
import { canManageKnowledge, canViewReviewQueue } from "@/lib/workflow";
import type { BrandData } from "@/lib/brand-data";
import type { Health, Role } from "@/lib/types";

interface DashboardData {
  health: Health;
  knowledge: BrandData;
}

const ROLE_COPY: Record<
  Role,
  { heading: string; summary: string; workTitle: string; workSummary: string }
> = {
  creator: {
    heading: "Create content with confidence",
    summary:
      "Keep your drafts moving and prepare clear, evidence-led content for review.",
    workTitle: "Your drafts and returned content",
    workSummary:
      "Personal content and status counts are unavailable because the backend does not yet expose content-list or content-detail APIs. The Write & Review screen remains a browser-local demo and is not shown here as saved work.",
  },
  reviewer: {
    heading: "Make every review count",
    summary:
      "Review submitted work, leave clear feedback, and make decisions when content is ready.",
    workTitle: "Content awaiting your review",
    workSummary:
      "The backend supports decisions and comments for a known content ID, but it does not expose a review queue or content list. No pending-review totals or findings can be verified here.",
  },
  brand_manager: {
    heading: "Keep the brand system clear",
    summary:
      "Manage the guidance, terminology, facts, and assets that inform brand-aligned work.",
    workTitle: "Brand knowledge at a glance",
    workSummary:
      "These totals come from the backend knowledge collections. The API does not currently list approved or ready-to-publish content.",
  },
  admin: {
    heading: "Workspace overview",
    summary:
      "Monitor the service and manage the brand knowledge available to the workspace.",
    workTitle: "Workspace operations",
    workSummary:
      "The dashboard reports live service health and backend knowledge totals. User management, workflow-wide statistics, and audit history are not exposed by the current API.",
  },
};

const KNOWLEDGE_LINKS = [
  { tab: "guidelines", label: "Guidelines" },
  { tab: "glossary", label: "Glossary" },
  { tab: "facts", label: "Facts" },
  { tab: "assets", label: "Assets" },
] as const;

function displayName(user: string): string {
  return user.replace(/\s+\([^)]*\)$/, "");
}

export default function Home() {
  const { role, label, user, isRoleLoaded } = useRole();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const mayManageKnowledge = canManageKnowledge(role);
  const mayViewQueue = canViewReviewQueue(role);
  const copy = ROLE_COPY[role];

  const refresh = useCallback(() => {
    setRetry((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!isRoleLoaded) return;

    const controller = new AbortController();
    setLoading(true);
    setError("");

    void Promise.all([
      api.health({ signal: controller.signal }),
      loadBrandData({ signal: controller.signal }),
    ])
      .then(([health, knowledge]) => {
        setData({ health, knowledge });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : "Could not load dashboard data.",
        );
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [isRoleLoaded, retry]);

  const counts = data
    ? [
        { label: "Guidelines", value: data.knowledge.guidelines.length },
        { label: "Glossary terms", value: data.knowledge.glossary.length },
        { label: "Approved facts", value: data.knowledge.facts.length },
        { label: "Brand assets", value: data.knowledge.assets.length },
      ]
    : [];
  const totalKnowledge = counts.reduce((total, item) => total + item.value, 0);

  return (
    <section className="page dashboard">
      <header className="dashboard-welcome">
        <div>
          <p className="eyebrow">CoRESpace / Home</p>
          <h1>Welcome back, {displayName(user)}</h1>
          <p className="lead">{copy.heading}</p>
          <p className="dashboard-summary">{copy.summary}</p>
        </div>
        <span className="dashboard-role-badge">{label}</span>
      </header>

      <section className="dashboard-data-section" aria-labelledby="snapshot-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">Live from your backend</p>
            <h2 id="snapshot-heading">Brand knowledge snapshot</h2>
          </div>
          {data && (
            <span
              className={
                data.health.status === "ok"
                  ? "dashboard-service-status is-online"
                  : "dashboard-service-status"
              }
              role="status"
            >
              <span className="dashboard-status-dot" aria-hidden="true" />
              {data.health.status === "ok"
                ? "API connected"
                : `API status: ${data.health.status}`}
            </span>
          )}
        </div>

        {loading || !isRoleLoaded ? (
          <p className="editor-notice" role="status">
            Loading live dashboard data...
          </p>
        ) : error ? (
          <div className="dashboard-error" role="alert">
            <p>Dashboard data could not be loaded: {error}</p>
            <button type="button" className="button" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : data ? (
          <>
            <div className="dashboard-stat-grid" aria-label="Backend knowledge totals">
              {counts.map((item) => (
                <article className="dashboard-stat-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>Records in the backend</small>
                </article>
              ))}
            </div>
            {totalKnowledge === 0 && (
              <p className="dashboard-empty-note" role="status">
                The backend collections are empty. A Brand Manager or Admin can
                add knowledge or load the sample brand.
              </p>
            )}
          </>
        ) : null}
      </section>

      <section className="dashboard-work-grid" aria-label={`${label} dashboard`}>
        <article className="card dashboard-work-card">
          <p className="eyebrow">For {label}</p>
          <h2>{copy.workTitle}</h2>
          <p className="dashboard-work-summary">{copy.workSummary}</p>

          {role === "brand_manager" && (
            <nav className="dashboard-knowledge-links" aria-label="Brand knowledge">
              {KNOWLEDGE_LINKS.map((item) => (
                <Link
                  className="button"
                  href={`/knowledge?tab=${item.tab}`}
                  key={item.tab}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}

          {role === "admin" && (
            <div className="dashboard-actions">
              <Link className="button button-primary" href="/knowledge">
                Manage brand knowledge
              </Link>
              <SampleBrandButton />
            </div>
          )}

          {role === "creator" && (
            <p className="dashboard-demo-link">
              <Link className="button" href="/editor">
                Open Write &amp; Review demo
              </Link>
              <span>
                This editor uses browser-local demonstration content; it is not
                a persisted draft.
              </span>
            </p>
          )}

          {role === "reviewer" && (
            <p className="dashboard-demo-link">
              {mayViewQueue && (
                <Link className="button" href="/queue">
                  Open review queue prototype
                </Link>
              )}
              <span>
                The queue is a local demonstration until a backend queue API is
                available.
              </span>
            </p>
          )}

          {mayManageKnowledge && role !== "admin" && (
            <Link className="button button-primary" href="/knowledge">
              Open brand knowledge
            </Link>
          )}
        </article>

        <article className="card dashboard-activity-card">
          <p className="eyebrow">Workflow</p>
          <h2>Recent activity</h2>
          <p>
            No workflow activity is shown because the backend does not expose
            content-list, queue, or audit-history endpoints. This avoids
            presenting browser-local demo events as organization records.
          </p>
          {role === "admin" && (
            <p className="muted">
              No user-management endpoint is implemented; administrative
              account controls are not available here.
            </p>
          )}
        </article>
      </section>

      {(role === "creator" || role === "reviewer") && (
        <section className="dashboard-next-steps card" aria-labelledby="next-steps-heading">
          <div>
            <p className="eyebrow">Next steps</p>
            <h2 id="next-steps-heading">
              {role === "creator"
                ? "Prepare content for review"
                : "Review submitted content"}
            </h2>
            <p>
              {role === "creator"
                ? "Content persistence and self-check workflow routes are needed before drafts, findings, suggested fixes, and reviewer comments can be shown here as backend data."
                : "The backend supports review actions for known content IDs. A role-scoped queue endpoint is needed before pending content, severity counts, and review actions can be listed here."}
            </p>
          </div>
          <Link className="button" href={role === "creator" ? "/editor" : "/queue"}>
            {role === "creator" ? "Open demo editor" : "Open queue prototype"}
          </Link>
        </section>
      )}

      {role === "brand_manager" && (
        <section className="dashboard-next-steps card" aria-labelledby="readiness-heading">
          <div>
            <p className="eyebrow">Content readiness</p>
            <h2 id="readiness-heading">Approved content and publishing</h2>
            <p>
              The backend supports marking a known approved content item ready
              to publish, but it does not provide a list of approved or
              publish-ready content. No readiness totals or actions can be
              populated safely.
            </p>
          </div>
        </section>
      )}
    </section>
  );
}
