"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { loadBrandData } from "@/lib/knowledge";
import type { DemoFinding } from "@/lib/mock-findings";
import type { BrandData } from "@/lib/brand-data";
import type { Content, Finding, FindingStatus } from "@/lib/types";
import FindingsPanel from "./FindingsPanel";

const EMPTY_DRAFT = { title: "Untitled draft", body: "" };

function toFinding(item: Finding, brand: BrandData): DemoFinding {
  const source = item.source;
  const knowledgeSource = source
    ? source.type === "guideline"
      ? (() => {
          const record = brand.guidelines.find((entry) => Number(entry.id) === source.id);
          return record ? { type: "guideline" as const, record } : undefined;
        })()
      : source.type === "term"
        ? (() => {
            const record = brand.glossary.find((entry) => Number(entry.id) === source.id);
            return record ? { type: "term" as const, record } : undefined;
          })()
        : (() => {
            const record = brand.facts.find((entry) => Number(entry.id) === source.id);
            return record ? { type: "fact" as const, record } : undefined;
          })()
    : undefined;
  return {
    ...item,
    text: item.text || item.evidence?.matched_text || "",
    start: item.start ?? item.start_offset ?? 0,
    end: item.end ?? item.end_offset ?? 0,
    explanation: item.explanation || item.message,
    suggestion: item.suggestion ?? item.suggested_fix,
    knowledge_source: knowledgeSource,
  };
}

export default function Editor() {
  const [brand, setBrand] = useState<BrandData | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [title, setTitle] = useState(EMPTY_DRAFT.title);
  const [body, setBody] = useState("");
  const [findings, setFindings] = useState<DemoFinding[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [knowledge, item] = await Promise.all([
        loadBrandData(),
        api.get<Content>("/api/content/1"),
      ]);
      setBrand(knowledge);
      setContent(item);
      setTitle(item.title);
      setBody(item.body);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) {
        try {
          const [knowledge, item] = await Promise.all([
            loadBrandData(),
            api.createContent(EMPTY_DRAFT),
          ]);
          setBrand(knowledge);
          setContent(item);
          setTitle(item.title);
          setBody(item.body);
        } catch (createReason) {
          setError(createReason instanceof Error ? createReason.message : "Could not create a draft.");
        }
      } else {
        setError(reason instanceof Error ? reason.message : "Could not load the brand and draft.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function changeDraft(nextTitle: string, nextBody: string) {
    setTitle(nextTitle);
    setBody(nextBody);
    setFindings(null);
  }

  async function saveDraft(): Promise<Content> {
    if (!content) throw new Error("No draft is loaded.");
    setSaving(true);
    try {
      const updated = await api.updateContent(content.id, { title, body });
      setContent(updated);
      return updated;
    } finally {
      setSaving(false);
    }
  }

  async function runReview() {
    if (!content || !brand || !body.trim() || reviewing) return;
    setReviewing(true);
    setError("");
    try {
      const updated = await saveDraft();
      const result = await api.reviewContent(updated.id);
      setFindings(result.findings.map((item) => toFinding(item, brand)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review failed. Try again.");
    } finally {
      setReviewing(false);
    }
  }

  async function resolveFinding(
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
  ) {
    try {
      const updated = await api.updateFinding(finding.id, status, finalText);
      setFindings((current) =>
        current?.map((item) => (item.id === finding.id ? toFinding(updated, brand!) : item)) ?? null,
      );
      if (finalText && (status === "accepted" || status === "edited")) {
        const nextBody = body.slice(0, finding.start) + finalText + body.slice(finding.end);
        setBody(nextBody);
        setFindings(null);
        await api.updateContent(content!.id, { title, body: nextBody });
      }
    } catch (reason) {
      throw reason instanceof Error ? reason : new Error("Could not update the finding.");
    }
  }

  if (loading) {
    return <section className="editor-page"><p className="editor-notice" role="status">Loading Lumina Home brand data and draft...</p></section>;
  }

  return (
    <section className="editor-page">
      <header className="editor-page-heading">
        <div>
          <p className="eyebrow">CoRESpace / Workspace</p>
          <h1>Write &amp; Review</h1>
          <p className="lead">Write content and review it against the fictional Lumina Home brand rules.</p>
        </div>
        <Link href="/knowledge" className="button">View brand knowledge</Link>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="editor-notice" role="note">Lumina Home is fictional demo content. Reviews use the brand data returned by the backend.</p>
      <div className="editor-layout">
        <section className="editor-card compose-panel" aria-labelledby="compose-heading">
          <div className="panel-heading"><div><p className="eyebrow">Draft</p><h2 id="compose-heading">Your content</h2></div></div>
          <div className="editor-fields">
            <label className="form-field" htmlFor="draft-title">Title
              <input id="draft-title" value={title} onChange={(event) => changeDraft(event.target.value, body)} disabled={saving || reviewing} />
            </label>
            <label className="form-field" htmlFor="draft-body">Content
              <textarea id="draft-body" ref={bodyRef} className="draft-textarea" value={body} onChange={(event) => changeDraft(title, event.target.value)} rows={14} disabled={saving || reviewing} />
            </label>
          </div>
          <div className="editor-controls">
            <span className="character-count">{body.length.toLocaleString()} characters</span>
            <button type="button" className="button button-primary" onClick={() => void runReview()} disabled={!body.trim() || reviewing || saving}>
              {reviewing ? "Reviewing..." : "Review content"}
            </button>
          </div>
        </section>
        <FindingsPanel
          findings={findings}
          busyFindingIds={[]}
          reviewState={reviewing ? "loading" : error ? "error" : findings ? "current" : "not-run"}
          reviewing={reviewing}
          canRunReview={Boolean(body.trim())}
          onRunReview={() => void runReview()}
          selectedFindingId={selectedFindingId}
          reviewedCustomText={false}
          onSelect={(finding) => {
            setSelectedFindingId(finding.id);
            bodyRef.current?.setSelectionRange(finding.start, finding.end);
            bodyRef.current?.focus();
          }}
          onResolve={resolveFinding}
        />
      </div>
    </section>
  );
}
