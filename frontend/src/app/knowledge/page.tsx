"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  BRAND_DATA_EVENT,
  BrandAsset,
  BrandData,
  BrandFact,
  EMPTY_BRAND_DATA,
  GlossaryTerm,
  Guideline,
} from "@/lib/brand-data";
import { loadBrandData } from "@/lib/knowledge";
import SampleBrandButton from "@/components/SampleBrandButton";

type TabKey = keyof BrandData;
type FormValues = Record<string, string>;
type KnowledgeItem = Guideline | GlossaryTerm | BrandFact | BrandAsset;

const TABS: { key: TabKey; label: string; itemLabel: string }[] = [
  { key: "guidelines", label: "Guidelines", itemLabel: "guideline" },
  { key: "glossary", label: "Glossary", itemLabel: "term" },
  { key: "facts", label: "Facts", itemLabel: "fact" },
  { key: "assets", label: "Assets", itemLabel: "asset" },
];

const FIELDS: Record<
  TabKey,
  { name: string; label: string; type?: string; required?: boolean }[]
> = {
  guidelines: [
    { name: "title", label: "Guideline", required: true },
    {
      name: "description",
      label: "What should people follow?",
      type: "textarea",
      required: true,
    },
  ],
  glossary: [
    { name: "term", label: "Term", required: true },
    { name: "definition", label: "Definition", type: "textarea", required: true },
    { name: "preferredTerm", label: "Preferred wording", required: true },
  ],
  facts: [
    { name: "claim", label: "Approved fact", type: "textarea", required: true },
    { name: "owner", label: "Owner", required: true },
    { name: "reviewDate", label: "Review date", type: "date", required: true },
  ],
  assets: [
    { name: "name", label: "Asset name", required: true },
    { name: "description", label: "Description", type: "textarea", required: true },
    { name: "url", label: "Asset URL (optional)" },
  ],
};

function emptyValues(tab: TabKey): FormValues {
  return Object.fromEntries(FIELDS[tab].map((field) => [field.name, ""]));
}

function isOutdated(reviewDate: string): boolean {
  const date = new Date(`${reviewDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function displayDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString();
}

function collectionPath(tab: TabKey): string {
  return `/api/${tab}`;
}

export default function KnowledgeBasePage() {
  const [data, setData] = useState<BrandData>(EMPTY_BRAND_DATA);
  const [activeTab, setActiveTab] = useState<TabKey>("guidelines");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await loadBrandData();
      setData(result);
      setLoadFailed(false);
      setError("");
    } catch (err) {
      setLoadFailed(true);
      setError(err instanceof Error ? err.message : "Could not load the brand knowledge.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const matchingTab = TABS.find((tab) => tab.key === requestedTab);
    if (matchingTab) setActiveTab(matchingTab.key);
    void refresh();
    function onBrandDataChanged() {
      void refresh();
    }
    window.addEventListener(BRAND_DATA_EVENT, onBrandDataChanged);
    return () => window.removeEventListener(BRAND_DATA_EVENT, onBrandDataChanged);
  }, [refresh]);

  function beginAdd() {
    setEditingId(null);
    setValues(emptyValues(activeTab));
    setFormOpen(true);
  }

  function beginEdit(item: KnowledgeItem) {
    setEditingId(item.id);
    const itemValues = { ...item } as Record<string, string>;
    delete itemValues.id;
    setValues(itemValues);
    setFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    );
    const url = editingId
      ? `${collectionPath(activeTab)}/${encodeURIComponent(editingId)}`
      : collectionPath(activeTab);

    try {
      if (editingId) {
        await api.put<KnowledgeItem>(url, payload);
      } else {
        await api.post<KnowledgeItem>(url, payload);
      }
      await refresh();
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this entry.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    setSaving(true);
    setError("");
    try {
      await api.delete<void>(
        `${collectionPath(activeTab)}/${encodeURIComponent(id)}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this entry.");
    } finally {
      setSaving(false);
    }
  }

  const items = data[activeTab];
  const currentTab = TABS.find((tab) => tab.key === activeTab)!;

  return (
    <section className="page">
      <div className="knowledge-heading">
        <div>
          <h1>Knowledge base</h1>
          <p className="lead">
            Manage the approved guidance, language, facts and assets for your brand.
          </p>
        </div>
        <SampleBrandButton />
      </div>

      <div className="knowledge-tabs" role="tablist" aria-label="Brand knowledge">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls="knowledge-panel"
            className={
              activeTab === tab.key ? "knowledge-tab active" : "knowledge-tab"
            }
            onClick={() => {
              setActiveTab(tab.key);
              setFormOpen(false);
              setEditingId(null);
              setError("");
            }}
          >
            {tab.label} <span className="tab-count">{data[tab.key].length}</span>
          </button>
        ))}
      </div>

      <section
        id="knowledge-panel"
        className="knowledge-panel"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
      >
        <div className="panel-heading">
          <div>
            <h2>{currentTab.label}</h2>
            <p className="muted">Changes are saved to the brand service.</p>
          </div>
          <button
            type="button"
            className="button button-primary"
            onClick={beginAdd}
            disabled={loading || saving}
          >
            Add {currentTab.itemLabel}
          </button>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {formOpen && (
          <form className="entry-form" onSubmit={submit}>
            <h3>{editingId ? "Edit entry" : `Add ${currentTab.itemLabel}`}</h3>
            {FIELDS[activeTab].map((field) => (
              <label className="form-field" key={field.name}>
                <span>{field.label}</span>
                {field.type === "textarea" ? (
                  <textarea
                    required={field.required}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [field.name]: event.target.value })
                    }
                    rows={3}
                  />
                ) : (
                  <input
                    type={field.type ?? "text"}
                    required={field.required}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [field.name]: event.target.value })
                    }
                  />
                )}
              </label>
            ))}
            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving..." : editingId ? "Save changes" : "Add entry"}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="muted" role="status">Loading brand knowledge...</p>
        ) : loadFailed ? (
          <div className="empty-state">
            <h3>Could not load the knowledge base</h3>
            <p>Check that the brand service is running, then try again.</p>
            <button type="button" className="button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <h3>No {currentTab.label.toLowerCase()} yet</h3>
            <p>
              Add your first {activeTab === "facts" ? "approved fact" : activeTab === "assets" ? "brand asset" : activeTab === "glossary" ? "glossary term" : "guideline"}, or load the sample brand to see how the knowledge base works.
            </p>
            <div className="empty-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={beginAdd}
              >
                Add your first {currentTab.itemLabel}
              </button>
              <SampleBrandButton />
            </div>
          </div>
        ) : (
          <ul className="entry-list">
            {items.map((item) => (
              <li className="entry-card" key={item.id}>
                <div className="entry-content">
                  {activeTab === "guidelines" && (
                    <>
                      <h3>{(item as Guideline).title}</h3>
                      <p>{(item as Guideline).description}</p>
                    </>
                  )}
                  {activeTab === "glossary" && (
                    <>
                      <h3>{(item as GlossaryTerm).term}</h3>
                      <p>{(item as GlossaryTerm).definition}</p>
                      <p className="entry-meta">
                        Preferred wording:{" "}
                        <strong>{(item as GlossaryTerm).preferredTerm}</strong>
                      </p>
                    </>
                  )}
                  {activeTab === "facts" && (
                    <>
                      <h3>{(item as BrandFact).claim}</h3>
                      <div className="fact-meta">
                        <span>
                          Owner: <strong>{(item as BrandFact).owner}</strong>
                        </span>
                        <span>
                          Review date:{" "}
                          <strong>
                            {displayDate((item as BrandFact).reviewDate)}
                          </strong>
                        </span>
                        {isOutdated((item as BrandFact).reviewDate) && (
                          <span className="outdated-badge">Outdated</span>
                        )}
                      </div>
                    </>
                  )}
                  {activeTab === "assets" && (
                    <>
                      <h3>{(item as BrandAsset).name}</h3>
                      <p>{(item as BrandAsset).description}</p>
                      {(item as BrandAsset).url && (
                        <p className="entry-meta">{(item as BrandAsset).url}</p>
                      )}
                    </>
                  )}
                </div>
                <div className="entry-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => beginEdit(item)}
                    disabled={saving}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void removeItem(item.id)}
                    disabled={saving}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
