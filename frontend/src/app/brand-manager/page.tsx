"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import { api } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import { useRole } from "@/lib/role";
import type { BrandManagerDashboard } from "@/lib/types";

export default function BrandManagerDashboardPage() {
  const { role, isRoleLoaded } = useRole();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<BrandManagerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await api.getBrandManagerDashboard(days));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isRoleLoaded && (role === "brand_manager" || role === "admin")) {
      void load();
    }
  }, [days, isRoleLoaded, role]);

  if (isRoleLoaded && role !== "brand_manager" && role !== "admin") {
    return (
      <section className="page">
        <EmptyState
          title="Dashboard restricted"
          description="Switch to the Brand Manager or Admin demo role to inspect brand performance."
          action={<Link className="button" href="/">Return home</Link>}
        />
      </section>
    );
  }

  return (
    <section className="page brand-manager-dashboard">
      <header className="dashboard-welcome">
        <div>
          <p className="eyebrow">CoRESpace / Brand Manager</p>
          <h1>Brand performance dashboard</h1>
          <p className="lead">
            Use persisted review and finding activity to identify rules that
            need clarification.
          </p>
        </div>
        <label className="form-field dashboard-period">
          Review period
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </label>
      </header>

      {loading && <div className="card dashboard-loading" role="status">Loading backend metrics...</div>}
      {error && (
        <div className="card dashboard-error" role="alert">
          <p>{error}</p>
          <button type="button" className="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        <>
          <section className="dashboard-data-section">
            <div className="dashboard-section-heading">
              <div><p className="eyebrow">Overview</p><h2>Selected period</h2></div>
              <span className="muted">{data.period.days} days · backend data</span>
            </div>
            <div className="dashboard-stat-grid">
              {[
                ["Active guidelines", data.overview.active_guidelines],
                ["Findings", data.overview.findings],
                ["Rules triggered", data.overview.guidelines_triggered],
                ["Reviews", data.overview.reviews],
                ["Dismissed findings", data.overview.dismissed_findings],
                ["Need review", data.overview.guidelines_needing_review],
              ].map(([label, value]) => (
                <article className="dashboard-stat-card" key={String(label)}>
                  <span>{label}</span><strong>{value}</strong>
                </article>
              ))}
            </div>
          </section>

          <DashboardTable
            title="Findings per rule"
            eyebrow="Most triggered"
            empty="No findings were recorded in this period."
            headers={["Rule", "Findings", "Categories", "Last cited"]}
            isEmpty={data.findings_per_rule.length === 0}
          >
            {data.findings_per_rule.map((item) => (
              <tr key={`${item.guideline_id}-${item.guideline_name}`}>
                <td>{item.guideline_name}</td><td>{item.finding_count}</td>
                <td>{Object.entries(item.categories).map(([name, count]) => `${name} (${count})`).join(", ")}</td>
                <td>{item.last_cited_at ? formatTimestamp(item.last_cited_at) : "No recorded activity"}</td>
              </tr>
            ))}
          </DashboardTable>

          <DashboardTable
            title="Frequently dismissed rules"
            eyebrow="Indicators for review, not proof a rule is incorrect"
            empty="No dismissed findings were recorded in this period."
            headers={["Rule", "Dismissals", "Decisions", "Dismissal rate"]}
            isEmpty={data.frequently_dismissed.length === 0}
          >
            {data.frequently_dismissed.map((item) => (
              <tr key={`${item.guideline_id}-${item.guideline_name}`}>
                <td>{item.guideline_name}</td><td>{item.dismissal_count}</td>
                <td>{item.decision_count}</td>
                <td>{item.dismissal_rate === null ? "Unavailable" : `${(item.dismissal_rate * 100).toFixed(1)}%`}</td>
              </tr>
            ))}
          </DashboardTable>

          <div className="dashboard-work-grid">
            <DashboardList title="Not cited recently" items={data.not_recently_cited.map((item) => `${item.guideline_name}: ${item.reason}`)} empty="All guidelines have recent citations." />
            <DashboardList title="Not reviewed recently" items={data.not_recently_reviewed.map((item) => `${item.guideline_name}: ${item.reason}`)} empty="No guideline review gaps are recorded." />
          </div>

          <section className="dashboard-data-section">
            <div className="dashboard-section-heading">
              <div><p className="eyebrow">Suggested clarifications</p><h2>Rules to review</h2></div>
              <Link className="button" href="/knowledge?tab=guidelines">Open guidelines</Link>
            </div>
            {data.clarifications.length === 0 ? (
              <p className="card dashboard-empty-note">No clarification suggestions were returned for this period.</p>
            ) : (
              <div className="dashboard-clarifications">
                {data.clarifications.map((item) => (
                  <article className="card" key={`${item.guideline_id}-${item.guideline_name}`}>
                    <p className="eyebrow">{item.status}</p>
                    <h3>{item.guideline_name}</h3>
                    <p>{item.suggestion}</p>
                    <p className="muted">{item.reason}</p>
                    <Link href="/knowledge?tab=guidelines">Review guideline</Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function DashboardTable({
  title,
  eyebrow,
  empty,
  headers,
  isEmpty,
  children,
}: {
  title: string;
  eyebrow: string;
  empty: string;
  headers: string[];
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-data-section">
      <div className="dashboard-section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>
      <div className="card dashboard-table-wrap">
        <table className="dashboard-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table>
        {isEmpty && <p className="dashboard-empty-note">{empty}</p>}
      </div>
    </section>
  );
}

function DashboardList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="card dashboard-list-card">
      <p className="eyebrow">Activity gaps</p><h2>{title}</h2>
      {items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">{empty}</p>}
    </section>
  );
}
