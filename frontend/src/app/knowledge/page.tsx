"use client";

import { useMemo, useState } from "react";
import { useRole } from "@/lib/role";
import {
  MOCK_DATA_NOTICE,
  removeMockKnowledgeItem,
  resetDemoWorkspace,
  saveMockKnowledgeItem,
  useDemoWorkspace,
} from "@/lib/mock-data";
import type { BrandData } from "@/lib/brand-data";
import { canManageKnowledge } from "@/lib/workflow";

type Tab = keyof BrandData;
const TABS: { key: Tab; label: string }[] = [
  { key: "guidelines", label: "Guidelines" },
  { key: "glossary", label: "Terminology" },
  { key: "facts", label: "Approved facts" },
  { key: "assets", label: "Assets" },
];

export default function KnowledgeBasePage() {
  const { role } = useRole();
  const workspace = useDemoWorkspace();
  const [tab, setTab] = useState<Tab>("guidelines");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const manageable = canManageKnowledge(role);
  const items = workspace.knowledge[tab];
  const filtered = useMemo(() => items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())), [items, query]);
  function titleFor(item: BrandData[Tab][number]): string {
    const record = item as unknown as Record<string, unknown>;
    return String(record.title ?? record.term ?? record.claim ?? record.name ?? "Untitled record");
  }
  function summaryFor(item: BrandData[Tab][number]): string {
    const record = item as unknown as Record<string, unknown>;
    return String(record.description ?? record.definition ?? record.owner ?? record.url ?? "");
  }

  function edit(item: Record<string, unknown> | null) {
    if (!manageable) return;
    setFormError("");
    setEditing(item ? String(item.id) : "");
    const defaults: Record<Tab, string[]> = {
      guidelines: ["title", "description", "category"],
      glossary: ["term", "definition", "preferredTerm", "status", "guidelineId"],
      facts: ["claim", "owner", "reviewDate", "source", "lastReviewed"],
      assets: ["name", "description", "url", "kind", "notes"],
    };
    setValues(item
      ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value ?? "")]))
      : Object.fromEntries(defaults[tab].map((key) => [key, ""])));
  }

  function save() {
    try {
      saveMockKnowledgeItem(tab, editing, values, role);
      setEditing(null);
      setFormError("");
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not save this record.");
    }
  }

  return (
    <section className="page">
      <header className="dashboard-welcome">
        <div><p className="eyebrow">CoRESpace / Brand Library</p><h1>Approved brand knowledge</h1><p className="lead">Search the evidence that powers Inline Copilot suggestions.</p><p className="dashboard-summary">{MOCK_DATA_NOTICE}</p></div>
        {manageable && <div className="entry-actions"><button className="button" type="button" onClick={() => edit(null)}>Add record</button><button className="button" type="button" onClick={() => { if (globalThis.confirm("Reset all demo documents, findings, workflow history, and knowledge?")) resetDemoWorkspace(role); }}>Reset demo data</button></div>}
      </header>
      <div className="knowledge-toolbar">
        <div className="tab-list" role="tablist">{TABS.map((item) => <button key={item.key} className={tab === item.key ? "tab active" : "tab"} type="button" role="tab" aria-selected={tab === item.key} onClick={() => { setTab(item.key); setEditing(null); }}>{item.label} <span>{workspace.knowledge[item.key].length}</span></button>)}</div>
        <input aria-label="Search brand knowledge" placeholder="Search library..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <p className="sample-data-label">Sample data · {filtered.length} records</p>
      <div className="knowledge-grid">
        {filtered.map((item) => (
          <article className="card knowledge-card" key={item.id}>
            <p className="eyebrow">{tab === "glossary" ? (item as BrandData["glossary"][number]).status : tab.slice(0, -1)}</p>
            <h2>{titleFor(item)}</h2>
            <p>{summaryFor(item)}</p>
            {"reviewDate" in item && <p className="muted">Review by {item.reviewDate} · Owner: {item.owner}</p>}
            {manageable && <div className="entry-actions"><button className="button" type="button" onClick={() => edit(item as unknown as Record<string, unknown>)}>Edit</button><button className="button button-danger" type="button" onClick={() => { if (window.confirm("Delete this demo record?")) removeMockKnowledgeItem(tab, String(item.id), role); }}>Delete</button></div>}
          </article>
        ))}
      </div>
      {filtered.length === 0 && <div className="card"><p className="muted">No matching records. Try another search.</p></div>}
      {editing !== null && manageable && (
        <div className="card knowledge-form">
          <h2>{editing ? "Edit record" : "Add record"}</h2>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          {Object.keys(values).filter((key) => key !== "id").map((key) => <label className="form-field" key={key}>{key}<input value={values[key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
          <button className="button button-primary" type="button" onClick={save}>Save record</button>
          <button className="button" type="button" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}
