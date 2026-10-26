/** Temporary body for pages that have not been built yet. Replace as each issue lands. */
export default function PagePlaceholder({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <div className="card">
        <p>{children}</p>
        <p className="muted">This screen is being built.</p>
      </div>
    </section>
  );
}
