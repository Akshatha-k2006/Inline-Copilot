"use client";

import { useLayoutEffect, useRef } from "react";
import type { DemoFinding } from "@/lib/findings";
import type { Severity } from "@/lib/types";

interface HighlightedDraftProps {
  body: string;
  findings: DemoFinding[];
  selectedFindingId: number | null;
  readOnly: boolean;
  onChange: (body: string) => void;
  onSelect: (finding: DemoFinding) => void;
}

interface FindingSegment {
  finding: DemoFinding;
  start: number;
  end: number;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  high: "Error",
  medium: "Warning",
  low: "Info",
};

function getSegments(body: string, findings: DemoFinding[]): FindingSegment[] {
  const sorted = findings
    .filter(
      (finding) =>
        finding.status === "open" &&
        finding.range_valid !== false &&
        Number.isInteger(finding.start) &&
        Number.isInteger(finding.end) &&
        finding.start >= 0 &&
        finding.end <= body.length &&
        finding.start < finding.end &&
        body.slice(finding.start, finding.end) === finding.text,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const segments: FindingSegment[] = [];
  let lastEnd = 0;
  for (const finding of sorted) {
    if (finding.start < lastEnd) continue;
    segments.push({ finding, start: finding.start, end: finding.end });
    lastEnd = finding.end;
  }
  return segments;
}

export default function HighlightedDraft({
  body,
  findings,
  selectedFindingId,
  readOnly,
  onChange,
  onSelect,
}: HighlightedDraftProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingSelection = useRef<{ anchor: number; focus: number } | null>(
    null,
  );
  const segments = getSegments(body, findings);
  let cursor = 0;
  const content = segments.map(({ finding, start, end }) => {
    const before = body.slice(cursor, start);
    cursor = end;
    return (
      <span key={finding.id}>
        {before}
        <mark
          id={`draft-highlight-${finding.id}`}
          data-finding-id={finding.id}
          className={`finding-highlight finding-highlight-${finding.severity}${selectedFindingId === finding.id ? " selected" : ""}`}
          aria-label={`${SEVERITY_LABELS[finding.severity] ?? "Unknown"}: ${String(finding.check ?? "Unknown").replaceAll("_", " ")}. ${finding.text ?? ""}`}
          onClick={() => onSelect(finding)}
        >
          {body.slice(start, end)}
        </mark>
      </span>
    );
  });

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const editor = editorRef.current;
    if (!selection || !editor) return;

    function pointAt(offset: number): [Node, number] {
      const walker = document.createTreeWalker(editor!, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let node = walker.nextNode();
      while (node) {
        const length = node.textContent?.length ?? 0;
        if (remaining <= length) return [node, remaining];
        remaining -= length;
        node = walker.nextNode();
      }
      const lastText = editor!.lastChild;
      return lastText?.nodeType === Node.TEXT_NODE
        ? [lastText, lastText.textContent?.length ?? 0]
        : [editor!, editor!.childNodes.length];
    }

    const [anchorNode, anchorOffset] = pointAt(selection.anchor);
    const [focusNode, focusOffset] = pointAt(selection.focus);
    const currentSelection = window.getSelection();
    currentSelection?.removeAllRanges();
    currentSelection?.setBaseAndExtent(
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset,
    );
    pendingSelection.current = null;
  }, [body]);

  function readContent(editor: HTMLDivElement) {
    const text = editor.textContent ?? "";
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const getOffset = (node: Node, offset: number) => {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.setEnd(node, offset);
        return range.toString().length;
      };
      pendingSelection.current = {
        anchor: getOffset(selection.anchorNode ?? editor, selection.anchorOffset),
        focus: getOffset(selection.focusNode ?? editor, selection.focusOffset),
      };
    }
    onChange(text);
  }

  function insertText(editor: HTMLDivElement, text: string) {
    const selection = window.getSelection();
    const range =
      selection?.rangeCount && editor.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null;
    if (!range) return;

    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStart(textNode, text.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    readContent(editor);
  }

  return (
    <section className="highlighted-draft-inline" aria-label="Inline highlights">
      <div
        ref={editorRef}
        className="document-editor highlighted-draft-text"
        role="textbox"
        aria-label="Document body with review highlights"
        aria-multiline="true"
        tabIndex={0}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={!readOnly}
        onInput={(event) => readContent(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !readOnly) {
            event.preventDefault();
            insertText(event.currentTarget, "\n");
          }
        }}
        onPaste={(event) => {
          if (readOnly) return;
          event.preventDefault();
          insertText(
            event.currentTarget,
            event.clipboardData.getData("text/plain"),
          );
        }}
      >
        {content}
        {body.slice(cursor)}
      </div>
    </section>
  );
}
