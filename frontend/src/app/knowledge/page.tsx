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
import {
  removeMockKnowledgeItem,
  saveMockKnowledgeItem,
  useDemoWorkspace,
} from "@/lib/mock-data";

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
    "Facts contain approved claims with an owner and review date. Demo facts and their sources are fictional and not verified.",
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
    {
      name: "description",
      label: "What should people follow?",
      type: "textarea",
      required: true,
    },
    { name: "kind", label: "Category (optional)" },
  ],
  glossary: [
    { name: "term", label: "Term", required: true },
    { name: "definition", label: "Definition", type: "textarea", required: true },
    { name: "preferredTerm", label: "Preferred wording" },
    {
      name: "status",
      label: "Terminology status",
      type: "select",
      required: true,
      options: [
        { value: "prohibited", label: "Prohibited" },
        { value: "approved", label: "Approved" },
      ],
    },
    { name: "guidelineId", label: "Related guideline ID (optional)" },
  ],
  facts: [
    { name: "claim", label: "Approved fact", type: "textarea", required: true },
    { name: "owner", label: "Owner", required: true },
    { name: "reviewDate", label: "Review date", type: "date", required: true },
    { name: "source", label: "Source reference (optional)" },
    { name: "lastReviewed", label: "Last reviewed (optional)", type: "date" },
  ],
  assets: [
    { name: "name", label: "Asset name", required: true },
    { name: "description", label: "Description", type: "textarea", required: true },
    { name: "url", label: "Asset URL (optional)" },
    { name: "kind", label: "Asset type (optional)" },
    { name: "notes", label: "Usage notes (optional)", type: "textarea" },
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
  const workspace = useDemoWorkspace();
  const { role } = useRole();
  const mayManageKnowledge = canManageKnowledge(role);
  const data = workspace.knowledge;
  const [activeTab, setActiveTab] = useState<TabKey>("guidelines");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const matchingTab = TABS.find((tab) => tab.queryValue === requestedTab);
    if (matchingTab) setActiveTab(matchingTab.key);
  }, []);

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
          .map(([key, value]) => [key, typeof value === "string" ? value : ""]),
      ),
    );
    setFormOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    );

    try {
      saveMockKnowledgeItem(activeTab, editingId, payload, role);
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this entry.");
    } finally {
      setSaving(false);
    }
  }

  function removeItem(id: string) {
    setSaving(true);
    setError("");
    try {
      removeMockKnowledgeItem(activeTab, id, role);
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
          <h1>Guidelines &amp; knowledge</h1>
          <p className="lead">
            Manage demonstration guidelines, glossary terms, facts and brand assets.
          </p>
        </div>
        <SampleBrandButton />
      </div>
      <p className="mock-data-notice" role="note">
        Fictional demonstration records only. Facts, source references, owners and review dates are not verified. Changes are local to this browser and are not sent to a backend.
      </p>
      {workspace.persistenceWarning && (
        <p className="form-error" role="alert">
          Saved knowledge records could not be loaded or saved in this browser: {workspace.persistenceWarning}
        </p>
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
            <p className="muted">Changes are shared with mock review results and persisted in this browser.</p>
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

        {!workspace.isHydrated ? (
          <p className="editor-notice" role="status">
            Loading saved {currentTab.label.toLowerCase()}...
          </p>
        ) : items.length === 0 && workspace.persistenceWarning ? (
          <div className="empty-state" role="alert">
            <h3>{currentTab.label} could not be loaded</h3>
            <p>
              Saved demonstration records are unavailable, so this section cannot confirm whether it is empty.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <h3>No {currentTab.label.toLowerCase()} yet</h3>
            <p>
              {mayManageKnowledge
                ? `${EMPTY_DESCRIPTIONS[activeTab]} Add your first ${currentTab.itemLabel}, or load the sample brand to see the demonstration records.`
                : `${EMPTY_DESCRIPTIONS[activeTab]} No demonstration records are available here yet. Switch to Brand Manager or Admin using the demo role selector to add or load records.`}
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
                <SampleBrandButton />
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
                      <p>{(item as Guideline).description}</p>
                      {(item as Guideline).kind && (
                        <p className="entry-meta">Category: {(item as Guideline).kind}</p>
                      )}
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
                        Status: <strong>{(item as GlossaryTerm).status ?? "unspecified"}</strong>
                      </p>
                      {(item as GlossaryTerm).guidelineId && (
                        <p className="entry-meta">
                          Related guideline:{" "}
                          <strong>
                            {data.guidelines.find(
                              (guideline) => guideline.id === (item as GlossaryTerm).guidelineId,
                            )?.title ?? `#${(item as GlossaryTerm).guidelineId}`}
                          </strong>
                        </p>
                      )}
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
                        {(item as BrandFact).source && (
                          <span>
                            Source: <strong>{(item as BrandFact).source}</strong>
                          </span>
                        )}
                        {(item as BrandFact).lastReviewed && (
                          <span>
                            Last reviewed: <strong>{displayDate((item as BrandFact).lastReviewed!)}</strong>
                          </span>
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
                      {(item as BrandAsset).kind && (
                        <p className="entry-meta">Type: {(item as BrandAsset).kind}</p>
                      )}
                      {(item as BrandAsset).notes &&
                        (item as BrandAsset).notes !== (item as BrandAsset).description && (
                        <p className="entry-meta">Notes: {(item as BrandAsset).notes}</p>
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
