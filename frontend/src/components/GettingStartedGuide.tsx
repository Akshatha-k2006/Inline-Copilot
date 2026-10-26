"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRole } from "@/lib/role";
import { canDecideReview, canManageKnowledge, canViewReviewQueue } from "@/lib/workflow";
import SampleBrandButton from "./SampleBrandButton";

const DISMISSED_KEY = "corespace-getting-started-dismissed-v1";

export default function GettingStartedGuide() {
  const { role } = useRole();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const mayLoadSampleBrand = canManageKnowledge(role);
  const mayViewQueue = canViewReviewQueue(role);
  const mayDecideReview = canDecideReview(role);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "true");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Keep the dismissal for this visit if browser storage is unavailable.
    }
  }

  function reopen() {
    setDismissed(false);
    try {
      window.localStorage.removeItem(DISMISSED_KEY);
    } catch {
      // The guide remains open for this visit even without browser storage.
    }
  }

  if (dismissed === null) return null;

  if (dismissed) {
    return (
      <button type="button" className="button guide-reopen" onClick={reopen}>
        Show getting-started guide
      </button>
    );
  }

  return (
    <section className="getting-started card" aria-labelledby="getting-started-heading">
      <div className="getting-started-header">
        <div>
          <p className="eyebrow">Quick start</p>
          <h2 id="getting-started-heading">Get started with CoRESpace</h2>
          <p className="muted">
            Follow the five steps documented in the project README. This demo uses fictional data and a role switcher, not secure sign-in.
          </p>
        </div>
        <button
          type="button"
          className="button guide-dismiss"
          onClick={dismiss}
          aria-label="Dismiss getting-started guide"
          title="Dismiss getting-started guide"
        >
          Dismiss
        </button>
      </div>
      <ol className="getting-started-steps">
        <li>
          <div>
            <strong>Open the live link.</strong>
            <p>
              You are already in CoRESpace. The README&apos;s deployed URL is still a placeholder.
            </p>
            <Link href="/">Go to the dashboard</Link>
          </div>
        </li>
        <li>
          <div>
            <strong>Click Load sample brand.</strong>
            <p>
              Load fictional guidelines, terminology, facts and assets to explore the demo.
              {!mayLoadSampleBrand &&
                " This action is available to the Brand Manager and Admin demo roles."}
            </p>
            <div className="guide-step-actions">
              {mayLoadSampleBrand && <SampleBrandButton />}
              <Link href="/knowledge?tab=guidelines">
                {mayLoadSampleBrand ? "View Guidelines" : "Open Guidelines"}
              </Link>
            </div>
          </div>
        </li>
        <li>
          <div>
            <strong>Click Run review on the sample draft (or paste your own text).</strong>
            <p>
              Open Write &amp; Review to run the known-phrase demonstration checks or enter text.
            </p>
            <Link href="/editor">Open Write &amp; Review</Link>
          </div>
        </li>
        <li>
          <div>
            <strong>Accept, edit or dismiss each flag.</strong>
            <p>
              Review each finding and choose how to handle it. Results are mock suggestions, not verified checks.
            </p>
            <Link href="/editor">Review the findings</Link>
          </div>
        </li>
        <li>
          <div>
            <strong>
              Submit for review, switch role to Reviewer (top bar), then approve or request changes.
            </strong>
            <p>
              {mayDecideReview
                ? "As Reviewer, open submitted content here to approve it or request changes."
                : mayViewQueue
                  ? "The creator submits eligible content. Your current role can inspect the queue; switch to Reviewer to approve or request changes."
                  : "Submit eligible content as Creator, then switch to Reviewer in the top bar to approve it or request changes."}
            </p>
            <Link href={mayViewQueue ? "/queue" : "/editor"}>
              {mayViewQueue ? "Open the Review queue" : "Submit in Write & Review"}
            </Link>
          </div>
        </li>
      </ol>
    </section>
  );
}
