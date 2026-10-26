import Link from "next/link";
import BackendStatus from "@/components/BackendStatus";

export default function Home() {
  return (
    <section className="page">
      <h1>Check content against your brand before it goes out</h1>
      <p className="lead">
        Inline Copilot reviews text against approved guidelines, glossary terms
        and facts, explains every issue with its source, and leaves the decision
        to a person. Nothing is published automatically.
      </p>

      <div className="card">
        <h2>Try it in five steps</h2>
        <ol className="steps">
          <li>Open the Knowledge base and load the sample brand.</li>
          <li>
            Open the Editor and run a review on the sample draft, or paste your
            own text.
          </li>
          <li>Accept, edit or dismiss each flag.</li>
          <li>Submit for review, then switch Role (top right) to Reviewer.</li>
          <li>Approve the content or request changes.</li>
        </ol>
        <p>
          <Link href="/knowledge" className="button button-primary">
            Open the Knowledge base
          </Link>
        </p>
      </div>

      <BackendStatus />
    </section>
  );
}
