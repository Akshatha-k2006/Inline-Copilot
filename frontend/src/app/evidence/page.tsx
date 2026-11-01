"use client";

import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import { api } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import { useRole } from "@/lib/role";
import type { EvidenceActivity, EvidenceRequest } from "@/lib/types";

type FormState = {
  sourceUrl: string;
  evidenceDescription: string;
  ownerExplanation: string;
};

const EMPTY_FORM: FormState = {
  sourceUrl: "",
  evidenceDescription: "",
  ownerExplanation: "",
};

function activityLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export default function EvidenceRequestsPage() {
  const { role, user } = useRole();
  const [requests, setRequests] = useState<EvidenceRequest[]>([]);
  const [activities, setActivities] = useState<Record<number, EvidenceActivity[]>>({});
  const [forms, setForms] = useState<Record<number, FormState>>({});
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function loadRequests() {
    setLoading(true);
    try {
      const loaded = await api.listEvidenceRequests();
      setRequests(loaded);
      const activityEntries = await Promise.all(
        loaded.map(async (request) => [request.id, await api.getEvidenceActivity(request.id)] as const),
      );
      setActivities(Object.fromEntries(activityEntries));
    } catch (cause) {
      setMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Evidence requests could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  function formFor(id: number): FormState {
    return forms[id] ?? EMPTY_FORM;
  }

  function updateForm(id: number, patch: Partial<FormState>) {
    setForms((current) => ({ ...current, [id]: { ...formFor(id), ...patch } }));
  }

  async function submitEvidence(request: EvidenceRequest) {
    const form = formFor(request.id);
    if (!form.sourceUrl.trim() || !/^https?:\/\/\S+$/i.test(form.sourceUrl.trim())) {
      setMessage({ kind: "error", text: "Enter a valid http(s) evidence source URL." });
      return;
    }
    if (!form.evidenceDescription.trim()) {
      setMessage({ kind: "error", text: "Describe the evidence before submitting." });
      return;
    }
    setBusy(request.id);
    setMessage(null);
    try {
      const updated = await api.attachEvidence(request.id, {
        sourceType: "url",
        sourceUrl: form.sourceUrl.trim(),
        evidenceDescription: form.evidenceDescription.trim(),
        ownerExplanation: form.ownerExplanation.trim() || undefined,
      });
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({ kind: "success", text: `Evidence submitted for request #${request.id}.` });
      const activity = await api.getEvidenceActivity(request.id);
      setActivities((current) => ({ ...current, [request.id]: activity }));
    } catch (cause) {
      setMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Evidence could not be submitted.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function decide(request: EvidenceRequest, decision: "approve" | "reject") {
    const text = feedback[request.id]?.trim() ?? "";
    if (!text) {
      setMessage({ kind: "error", text: "Enter reviewer feedback before deciding." });
      return;
    }
    setBusy(request.id);
    setMessage(null);
    try {
      const updated =
        decision === "approve"
          ? await api.approveEvidenceRequest(request.id, text)
          : await api.rejectEvidenceRequest(request.id, text);
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({
        kind: "success",
        text: `Request #${request.id} was ${decision === "approve" ? "approved" : "rejected"}.`,
      });
      const activity = await api.getEvidenceActivity(request.id);
      setActivities((current) => ({ ...current, [request.id]: activity }));
    } catch (cause) {
      setMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : "The decision could not be saved.",
      });
    } finally {
      setBusy(null);
    }
  }

  const canDecide = role === "reviewer" || role === "admin" || role === "brand_manager";

  return (
    <section className="page evidence-page">
      <header className="editor-page-heading">
        <div>
          <p className="eyebrow">CoRESpace / Evidence</p>
          <h1>Evidence requests</h1>
          <p className="lead">Submit supporting sources and record an accountable review decision.</p>
        </div>
      </header>
      {message && (
        <p className={message.kind === "error" ? "editor-error" : "editor-notice"} role="status">
          {message.text}
        </p>
      )}
      {loading ? (
        <div className="editor-empty-state" role="status"><h2>Loading evidence requests...</h2></div>
      ) : requests.length === 0 ? (
        <EmptyState title="No evidence requests" description="Requests created from unsupported claims will appear here." />
      ) : (
        <div className="evidence-request-page-list">
          {requests.map((request) => {
            const form = formFor(request.id);
            const isAssignedOwner =
              user === request.assignee ||
              user === request.assignee.split(" (")[0];
            const canSubmit =
              request.status === "open" && !request.sourceType && isAssignedOwner;
            const isBusy = busy === request.id;
            return (
              <article className="editor-card evidence-detail-card" key={request.id}>
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Request #{request.id} · Finding #{request.findingId}</p>
                    <h2>{request.claimText}</h2>
                  </div>
                  <span className={`finding-status status-${request.status}`}>{request.status}</span>
                </div>
                <dl className="evidence-detail-grid">
                  <div><dt>Reason</dt><dd>{request.reason}</dd></div>
                  <div><dt>Assigned owner</dt><dd>{request.assignee}</dd></div>
                  <div><dt>Created</dt><dd>{formatTimestamp(request.createdAt)}</dd></div>
                </dl>
                {request.sourceType ? (
                  <div className="evidence-submission">
                    <h3>Submitted evidence</h3>
                    {request.sourceUrl && (
                      <p><a href={request.sourceUrl} target="_blank" rel="noopener noreferrer">Open evidence source</a></p>
                    )}
                    <p><strong>Description:</strong> {request.evidenceDescription || "Not provided"}</p>
                    {request.ownerExplanation && <p><strong>Owner explanation:</strong> {request.ownerExplanation}</p>}
                    <p className="muted">Submitted by {request.attachedBy || "Unknown"} · {request.attachedAt ? formatTimestamp(request.attachedAt) : "Unknown time"}</p>
                  </div>
                ) : canSubmit ? (
                  <div className="evidence-submission evidence-form">
                    <h3>Submit evidence</h3>
                    <p className="muted">Signed in as {user}. Provide a source URL and explain how it supports the claim.</p>
                    <label className="form-field">Evidence source URL<input value={form.sourceUrl} onChange={(event) => updateForm(request.id, { sourceUrl: event.target.value })} placeholder="https://example.com/source" /></label>
                    <label className="form-field">Evidence title or description<textarea rows={2} value={form.evidenceDescription} onChange={(event) => updateForm(request.id, { evidenceDescription: event.target.value })} /></label>
                    <label className="form-field">Optional owner explanation<textarea rows={2} value={form.ownerExplanation} onChange={(event) => updateForm(request.id, { ownerExplanation: event.target.value })} /></label>
                    <button className="button button-primary" type="button" disabled={isBusy} onClick={() => void submitEvidence(request)}>
                      {isBusy ? "Submitting..." : "Submit evidence"}
                    </button>
                  </div>
                ) : request.status === "open" && !request.sourceType ? (
                  <p className="muted">
                    Awaiting evidence from the assigned owner, {request.assignee}.
                  </p>
                ) : null}
                {request.decision && (
                  <div className="evidence-decision">
                    <h3>Decision: {request.decision}</h3>
                    <p>{request.reviewerFeedback}</p>
                    <p className="muted">Reviewed by {request.decidedBy || "Unknown"} · {request.decidedAt ? formatTimestamp(request.decidedAt) : "Unknown time"}</p>
                  </div>
                )}
                {canDecide && request.sourceType && !request.decision && (
                  <div className="evidence-decision evidence-form">
                    <h3>Review evidence</h3>
                    <label className="form-field">Reviewer feedback<textarea rows={2} value={feedback[request.id] ?? ""} onChange={(event) => setFeedback((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Explain your decision." /></label>
                    <div className="finding-actions">
                      <button className="button button-danger" type="button" disabled={isBusy} onClick={() => void decide(request, "reject")}>Reject</button>
                      <button className="button button-primary" type="button" disabled={isBusy} onClick={() => void decide(request, "approve")}>Approve</button>
                    </div>
                  </div>
                )}
                <details className="evidence-activity">
                  <summary>Activity ({activities[request.id]?.length ?? 0})</summary>
                  {(activities[request.id] ?? []).map((activity) => (
                    <p key={activity.id}><strong>{activityLabel(activity.eventType)}</strong> · {activity.actor} · {formatTimestamp(activity.timestamp)}</p>
                  ))}
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
