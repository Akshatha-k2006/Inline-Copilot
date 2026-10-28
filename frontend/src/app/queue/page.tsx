"use client";

import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import { useRole } from "@/lib/role";
import { addDemoReviewComment, getQueuedDocuments, useDemoWorkspace, transitionDemoDocument, formatMockTimestamp } from "@/lib/mock-data";
import { canViewReviewQueue } from "@/lib/workflow";
import { useState } from "react";

export default function ReviewQueuePage() {
  const { role, user } = useRole();
  const workspace = useDemoWorkspace();
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const queued = getQueuedDocuments(workspace);
  if (!canViewReviewQueue(role)) return <section className="page"><EmptyState title="Review queue is for reviewers" description="Creators can prepare drafts in the Inline Editor." action={<Link className="button button-primary" href="/editor">Open editor</Link>} /></section>;
  function decide(id: number, action: "approve" | "request_changes" | "reject") {
    try { transitionDemoDocument(id, action, role, user, comment); setComment(""); setMessage(action === "approve" ? "Content approved and ready to publish." : action === "reject" ? "Content rejected with a recorded reason." : "Changes requested; the creator can resubmit."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "The review action could not be completed."); }
  }
  return <section className="page"><header><p className="eyebrow">CoRESpace / Review Queue</p><h1>Review submitted work</h1><p className="lead">Inspect the draft, its evidence, and the decisions recorded in this demo workspace.</p></header>{message && <p className="editor-notice" role="status">{message}</p>}{queued.length === 0 ? <EmptyState title="No documents are waiting for review" description="Submit a reviewed draft as the Creator role to see it here." action={<Link className="button button-primary" href="/editor">Open editor</Link>} /> : <div className="entry-list">{queued.map((document) => <article className="entry-card card" key={document.id}><div className="entry-content"><p className="eyebrow">Submitted {formatMockTimestamp(document.updated_at)}</p><h2>{document.title}</h2><p className="muted">{document.body.slice(0, 220)}{document.body.length > 220 ? "…" : ""}</p>{role === "reviewer" && <textarea aria-label={`Review comment for ${document.title}`} placeholder="Add a comment or decision reason..." value={comment} onChange={(event) => setComment(event.target.value)} rows={3} />}</div><div className="entry-actions"><Link className="button" href={`/editor?id=${document.id}`}>Inspect</Link>{role === "reviewer" && <><button className="button button-primary" type="button" onClick={() => decide(document.id, "approve")}>Approve</button><button className="button" type="button" onClick={() => decide(document.id, "request_changes")}>Request changes</button><button className="button button-danger" type="button" onClick={() => decide(document.id, "reject")}>Reject</button><button className="button" type="button" onClick={() => { try { addDemoReviewComment(document.id, role, user, comment); setComment(""); setMessage("Comment added."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Comment could not be added."); } }}>Add comment</button></>}</div></article>)}</div>}</section>;
}
