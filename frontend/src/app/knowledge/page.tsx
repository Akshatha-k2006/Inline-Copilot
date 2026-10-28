"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  BrandAsset,
  BrandData,
  BrandFact,
  GlossaryTerm,
  Guideline,
} from "@/lib/brand-data";
import SampleBrandButton from "@/components/SampleBrandButton";
import { useRole } from "@/lib/role";
import { canManageKnowledge } from "@/lib/workflow";
import { ApiError, api } from "@/lib/api";
import { EMPTY_BRAND_DATA } from "@/lib/brand-data";
import { loadBrandData } from "@/lib/knowledge";

type TabKey = keyof BrandData;
type FormValues = Record<string, string>;
type KnowledgeItem = Guideline | GlossaryTerm | BrandFact | BrandAsset;

const TABS: {
  key: TabKey;
  label: string;
  itemLabel: string;
  queryValue: string;
}[] = [
  { key: "guidelines", label: "Guidelines", itemLabel: "guideline", queryValue: "guidelines" },
  { key: "glossary", label: "Glossary", itemLabel: "term", queryValue: "glossary" },
  { key: "facts", label: "Facts", itemLabel: "fact", queryValue: "facts" },
  { key: "assets", label: "Assets", itemLabel: "asset", queryValue: "assets" },
];

const EMPTY_DESCRIPTIONS: Record<TabKey, string> = {
  guidelines:
    "Guidelines describe the brand voice, style rules, and content requirements people should follow.",
  glossary:
    "Glossary entries define preferred terms, approved wording, and words or phrases to avoid.",
  facts:
    "Facts contain approved claims with an owner and review date.",
  assets:
    "Assets hold approved brand resources such as logos, imagery, and usage notes.",
};

const FIELDS: Record<
  TabKey,
  {
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    options?: { value: string; label: string }[];
  }[]
> = {
  guidelines: [
    { name: "title", label: "Guideline", required: true },
    { name: "category", label: "Category", required: true },
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
    { name: "preferredTerm", label: "Preferred wording" },
    {
      name: "status",
      label: "Status",
      required: true,
      options: [
        { value: "prohibited", label: "Prohibited" },
        { value: "approved", label: "Approved" },
      ],
    },
    { name: "guidelineId", label: "Related guideline" },
  ],
  facts: [
    { name: "claim", label: "Approved fact", type: "textarea", required: true },
    { name: "owner", label: "Owner", required: true },
    { name: "source", label: "Source" },
    { name: "lastReviewed", label: "Last reviewed", type: "date" },
    { name: "reviewDate", label: "Review by", type: "date", required: true },
  ],
  assets: [
    { name: "name", label: "Asset name", required: true },
    { name: "assetType", label: "Asset type", required: true },
    { name: "description", label: "Description", type: "textarea", required: true },
    { name: "url", label: "Asset URL (optional)" },
  ],
};

function emptyValues(tab: TabKey): FormValues {
  return Object.fromEntries(
    FIELDS[tab].map((field) => [
      field.name,
      field.options?.[0]?.value ?? "",
    ]),
  );
}

function isOutdated(reviewDate: string): boolean {
  const date = new Date(`${reviewDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return reviewDate < new Date().toISOString().slice(0, 10);
}

function displayDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(parsed);
}

export default function KnowledgeBasePage() {
  const { role } = useRole();
  const mayManageKnowledge = canManageKnowledge(role);
  const [data, setData] = useState<BrandData>(EMPTY_BRAND_DATA);
  const [activeTab, setActiveTab] = useState<TabKey>("guidelines");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const matchingTab = TABS.find((tab) => tab.queryValue === requestedTab);
    if (matchingTab) setActiveTab(matchingTab.key);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void loadBrandData({ signal: controller.signal })
      .then(setData)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLoadError(
          cause instanceof Error ? cause.message : "Could not load brand knowledge.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [role, refreshVersion]);

  function beginAdd() {
    if (!mayManageKnowledge) return;
    setEditingId(null);
    setValues(emptyValues(activeTab));
    setFormOpen(true);
  }

  function beginEdit(item: KnowledgeItem) {
    if (!mayManageKnowledge) return;
    setEditingId(item.id);
    setValues(
      Object.fromEntries(
        Object.entries(item)
          .filter(([key]) => key !== "id")
          .map(([key, value]) => [
            key,
            typeof value === "string"
              ? value
              : typeof value === "number"
                ? String(value)
                : "",
          ]),
      ),
    );
    setFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    );

    try {
      const id = editingId === null ? undefined : Number(editingId);
      switch (activeTab) {
        case "guidelines": {
          const item = {
            title: payload.title,
            description: payload.description,
            category: payload.category,
          };
          if (id === undefined) await api.createGuideline(item);
          else await api.updateGuideline(id, item);
          break;
        }
        case "glossary": {
          const item = {
            term: payload.term,
            definition: payload.definition,
            preferredTerm: payload.preferredTerm || null,
            status:
              payload.status === "approved"
                ? ("approved" as const)
                : ("prohibited" as const),
            guidelineId: payload.guidelineId
              ? Number(payload.guidelineId)
              : null,
          };
          if (id === undefined) await api.createGlossaryTerm(item);
          else await api.updateGlossaryTerm(id, item);
          break;
        }
        case "facts": {
          const item = {
            claim: payload.claim,
            owner: payload.owner,
            reviewDate: payload.reviewDate,
            source: payload.source,
            lastReviewed: payload.lastReviewed || null,
          };
          if (id === undefined) await api.createFact(item);
          else await api.updateFact(id, item);
          break;
        }
        case "assets": {
          const item = {
            name: payload.name,
            description: payload.description,
            url: payload.url || null,
            assetType: payload.assetType,
          };
          if (id === undefined) await api.createAsset(item);
          else await api.updateAsset(id, item);
          break;
        }
      }
      setFormOpen(false);
      setEditingId(null);
      setRefreshVersion((version) => version + 1);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not save this entry.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    if (!window.confirm("Delete this record? This action cannot be undone.")) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      const itemId = Number(id);
      switch (activeTab) {
        case "guidelines":
          await api.deleteGuideline(itemId);
          break;
        case "glossary":
          await api.deleteGlossaryTerm(itemId);
          break;
        case "facts":
          await api.deleteFact(itemId);
          break;
        case "assets":
          await api.deleteAsset(itemId);
          break;
      }
      setRefreshVersion((version) => version + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this entry.",
      );
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
          <h1>Guidelines &amp; knowledge</h1>
          <p className="lead">
            Manage guidelines, glossary terms, facts and brand assets saved by the backend.
          </p>
        </div>
        {mayManageKnowledge && (
          <SampleBrandButton
            onLoaded={() => setRefreshVersion((version) => version + 1)}
          />
        )}
      </div>
      <p className="mock-data-notice" role="note">
        Sample brand records are fictional. Changes made here are sent to the configured backend and stored in its database.
      </p>
      {loadError && (
        <p className="form-error" role="alert">
          Brand knowledge could not be loaded: {loadError}
        </p>
      )}
      {loadError && (
        <button
          type="button"
          className="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
        >
          Retry loading
        </button>
      )}
      {!mayManageKnowledge && (
        <p className="editor-notice" role="note">
          Knowledge records are read-only for {role.replaceAll("_", " ")}. Switch to Brand Manager or Admin to manage them.
        </p>
      )}

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
              window.history.replaceState(
                null,
                "",
                `/knowledge?tab=${tab.queryValue}`,
              );
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
            <p className="muted">Changes are saved through the backend API.</p>
          </div>
          {mayManageKnowledge && (
            <button
              type="button"
              className="button button-primary"
              onClick={beginAdd}
              disabled={saving}
            >
              Add {currentTab.itemLabel}
            </button>
          )}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {formOpen && mayManageKnowledge && (
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
                ) : field.name === "guidelineId" ? (
                  <select
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [field.name]: event.target.value })
                    }
                  >
                    <option value="">No related guideline</option>
                    {data.guidelines.map((guideline) => (
                      <option key={guideline.id} value={guideline.id}>
                        {guideline.title}
                      </option>
                    ))}
                  </select>
                ) : field.options ? (
                  <select
                    required={field.required}
                    value={values[field.name] ?? field.options[0].value}
                    onChange={(event) =>
                      setValues({ ...values, [field.name]: event.target.value })
                    }
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
          <p className="editor-notice" role="status">
            Loading {currentTab.label.toLowerCase()} from the backend...
          </p>
        ) : loadError ? (
          <div className="empty-state" role="alert">
            <h3>{currentTab.label} could not be loaded</h3>
            <p>
              The backend did not return this collection, so it cannot be treated as empty.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <h3>No {currentTab.label.toLowerCase()} yet</h3>
            <p>
              {mayManageKnowledge
                ? `${EMPTY_DESCRIPTIONS[activeTab]} Add your first ${currentTab.itemLabel}, or load the sample brand.`
                : `${EMPTY_DESCRIPTIONS[activeTab]} No records are available yet. Switch to Brand Manager or Admin to manage knowledge.`}
            </p>
            {mayManageKnowledge && (
              <div className="empty-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={beginAdd}
                >
                  Add your first {currentTab.itemLabel}
                </button>
                <SampleBrandButton
                  onLoaded={() => setRefreshVersion((version) => version + 1)}
                />
              </div>
            )}
          </div>
        ) : (
          <ul className="entry-list">
            {items.map((item) => (
              <li className="entry-card" key={item.id}>
                <div className="entry-content">
                  {activeTab === "guidelines" && (
                    <>
                      <h3>{(item as Guideline).title}</h3>
                      <p className="entry-meta">
                        Category: <strong>{(item as Guideline).category}</strong>
                      </p>
                      <p>{(item as Guideline).description}</p>
                    </>
                  )}
                  {activeTab === "glossary" && (
                    <>
                      <h3>{(item as GlossaryTerm).term}</h3>
                      <p>{(item as GlossaryTerm).definition}</p>
                      <p className="entry-meta">
                        Preferred wording: <strong>{(item as GlossaryTerm).preferredTerm || "None"}</strong>
                      </p>
                      <p className="entry-meta">
                        Status: <strong>{(item as GlossaryTerm).status ?? "prohibited"}</strong>
                        {(item as GlossaryTerm).guidelineId &&
                          ` · Guideline #${(item as GlossaryTerm).guidelineId}`}
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
                        {(item as BrandFact).source && (
                          <span>
                            Source: <strong>{(item as BrandFact).source}</strong>
                          </span>
                        )}
                        {(item as BrandFact).lastReviewed && (
                          <span>
                            Last reviewed:{" "}
                            <strong>
                              {displayDate((item as BrandFact).lastReviewed!)}
                            </strong>
                          </span>
                        )}
                        <span>
                          Review date:{" "}
                          <strong>
                            {displayDate((item as BrandFact).reviewDate)}
                          </strong>
                        </span>
                        {((item as BrandFact).outdated ??
                          isOutdated((item as BrandFact).reviewDate)) && (
                          <span className="outdated-badge">Outdated</span>
                        )}
                      </div>
                    </>
                  )}
                  {activeTab === "assets" && (
                    <>
                      <h3>{(item as BrandAsset).name}</h3>
                      <p className="entry-meta">
                        Type: <strong>{(item as BrandAsset).kind ?? "other"}</strong>
                      </p>
                      <p>{(item as BrandAsset).description}</p>
                      {(item as BrandAsset).url && (
                        <p className="entry-meta">{(item as BrandAsset).url}</p>
                      )}
                    </>
                  )}
                </div>
                {mayManageKnowledge && <div className="entry-actions">
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
                    onClick={() => removeItem(item.id)}
                    disabled={saving}
                  >
                    Delete
                  </button>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
