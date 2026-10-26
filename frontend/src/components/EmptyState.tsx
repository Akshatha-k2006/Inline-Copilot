import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}

export default function EmptyState({
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <section className="empty-state contextual-empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {(action || secondaryAction) && (
        <div className="empty-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </section>
  );
}
