"use client";

import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import { useRole } from "@/lib/role";
import { useDemoWorkspace, formatMockTimestamp } from "@/lib/mock-data";

export default function AuditPage() {
  const { role } = useRole();
  const workspace = useDemoWorkspace();
  if (role !== "admin" && role !== "brand_manager") return <section className="page"><EmptyState title="Audit trail is restricted" description="Switch to the Brand Manager or Admin demo role to inspect workspace activity." action={<Link className="button" href="/">Return home</Link>} /></section>;
  return <section className="page"><header><p className="eyebrow">CoRESpace / Audit Trail</p><h1>Workspace activity</h1><p className="lead">Every demo edit, finding decision, and workflow transition is visible here.</p></header>{workspace.history.length === 0 ? <EmptyState title="No activity yet" description="Actions in the editor and brand library will appear here." action={<Link className="button" href="/editor">Open editor</Link>} /> : <ol className="mock-history-list">{[...workspace.history].reverse().map((event) => <li className="mock-history-item" key={event.id}><time dateTime={event.at}>{formatMockTimestamp(event.at)}</time><div><span className="audit-event-type">{event.action.replaceAll("_", " ")}</span><h2>{event.detail}</h2><p className="muted">{event.actor} · {event.content_title}</p>{event.content_id && <Link href={`/editor?id=${event.content_id}`}>Inspect document</Link>}</div></li>)}</ol>}</section>;
}
