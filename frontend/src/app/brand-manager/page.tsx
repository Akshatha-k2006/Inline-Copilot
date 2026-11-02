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
        <div className="dashboard-period" aria-label="Review period">
          <span className="muted">Review period</span>
          <div className="dashboard-period-buttons" role="group">
            {([
              [7, "7 days"],
              [30, "1 month"],
              [365, "1 year"],
            ] as Array<[number, string]>).map(([value, label]) => (
              <button
                className={`button ${days === value ? "button-primary" : ""}`}
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => setDays(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
            <div className="card dashboard-overview-chart">
              <div>
                <p className="eyebrow">Activity mix</p>
                <h3>Selected period overview</h3>
                <p className="muted">How recorded activity is distributed in this period.</p>
              </div>
              <OverviewPieChart overview={data.overview} />
            </div>
          </section>

          <section className="dashboard-data-section">
            <div className="dashboard-section-heading">
              <div>
                <p className="eyebrow">Rule activity</p>
                <h2>Findings by rule</h2>
              </div>
              <span className="muted">Last {data.period.days} days</span>
            </div>
            <div className="card dashboard-chart" aria-label="Findings by rule graph">
              {data.findings_per_rule.length === 0 ? (
                <p className="dashboard-empty-note">No rule activity in this period.</p>
              ) : (
                <FindingsChart items={data.findings_per_rule.slice(0, 8)} />
              )}
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

function FindingsChart({
  items,
}: {
  items: BrandManagerDashboard["findings_per_rule"];
}) {
  const width = 760;
  const height = 260;
  const chartTop = 24;
  const chartBottom = 190;
  const chartHeight = chartBottom - chartTop;
  const maximum = Math.max(...items.map((item) => item.finding_count), 1);
  const barWidth = Math.min(64, Math.max(28, 520 / items.length));
  const gap = (width - 100 - items.length * barWidth) / Math.max(items.length, 1);

  return (
    <svg
      className="dashboard-svg-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Bar chart showing findings per rule"
    >
      <line x1="70" y1={chartTop} x2="70" y2={chartBottom} className="dashboard-chart-axis" />
      <line x1="70" y1={chartBottom} x2={width - 24} y2={chartBottom} className="dashboard-chart-axis" />
      <text x="12" y={chartTop + 5} className="dashboard-chart-label">{maximum}</text>
      <text x="22" y={chartBottom + 5} className="dashboard-chart-label">0</text>
      {items.map((item, index) => {
        const x = 86 + index * (barWidth + gap);
        const barHeight = (item.finding_count / maximum) * chartHeight;
        const y = chartBottom - barHeight;
        const label = item.guideline_name.length > 14
          ? `${item.guideline_name.slice(0, 12)}…`
          : item.guideline_name;
        return (
          <g key={`${item.guideline_id}-${item.guideline_name}`}>
            <title>{`${item.guideline_name}: ${item.finding_count} findings`}</title>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 2)}
              rx="6"
              className="dashboard-chart-column"
            />
            <text x={x + barWidth / 2} y={Math.max(y - 8, 14)} textAnchor="middle" className="dashboard-chart-value">
              {item.finding_count}
            </text>
            <text x={x + barWidth / 2} y={chartBottom + 24} textAnchor="middle" className="dashboard-chart-label">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function OverviewPieChart({
  overview,
}: {
  overview: BrandManagerDashboard["overview"];
}) {
  const entries = [
    { label: "Findings", value: overview.findings, color: "#0f766e" },
    { label: "Reviews", value: overview.reviews, color: "#d97706" },
    { label: "Dismissed", value: overview.dismissed_findings, color: "#b45309" },
  ];
  const total = entries.reduce((sum, item) => sum + item.value, 0);
  const center = 90;
  const radius = 62;
  let startAngle = -Math.PI / 2;

  function point(angle: number) {
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  }

  return (
    <div className="dashboard-pie-layout">
      <svg
        className="dashboard-pie-chart"
        viewBox="0 0 180 180"
        role="img"
        aria-label="Pie chart showing the selected period activity mix"
      >
        {total === 0 ? (
          <circle cx={center} cy={center} r={radius} className="dashboard-pie-empty" />
        ) : (
          entries.map((entry) => {
            const sliceAngle = (entry.value / total) * Math.PI * 2;
            const endAngle = startAngle + sliceAngle;
            const start = point(startAngle);
            const end = point(endAngle);
            const largeArc = sliceAngle > Math.PI ? 1 : 0;
            const path = [
              `M ${center} ${center}`,
              `L ${start.x} ${start.y}`,
              `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
              "Z",
            ].join(" ");
            startAngle = endAngle;
            return (
              <path key={entry.label} d={path} fill={entry.color}>
                <title>{`${entry.label}: ${entry.value}`}</title>
              </path>
            );
          })
        )}
        <circle cx={center} cy={center} r="31" className="dashboard-pie-hole" />
        <text x={center} y={center + 5} textAnchor="middle" className="dashboard-pie-total">
          {total}
        </text>
      </svg>
      <ul className="dashboard-pie-legend">
        {entries.map((entry) => (
          <li key={entry.label}>
            <span className="dashboard-pie-swatch" style={{ backgroundColor: entry.color }} />
            <span>{entry.label}</span>
            <strong>{entry.value}</strong>
          </li>
        ))}
      </ul>
    </div>
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
