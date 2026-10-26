import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join("mocks", name), "utf8"));
}

function assertUniqueIds(records, label) {
  const ids = records.map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length, `${label} contains duplicate IDs`);
}

const contentFixture = fixture("content.json");
const content = contentFixture["POST /api/content"];
const review = fixture("review.json")["response"];
const auditFixture = fixture("audit.json");
const auditEndpoint = auditFixture.endpoint;
assert.match(
  auditEndpoint,
  /^GET \/api\/content\/\d+\/audit$/,
  "audit fixture must declare its content-scoped endpoint",
);
const auditContentId = Number(auditEndpoint.split("/")[3]);
const audit = auditFixture.response;

const guidelines = fixture("guidelines.json")["GET /api/guidelines"];
const terms = fixture("terms.json")["GET /api/terms"];
const facts = fixture("facts.json")["GET /api/facts"];
const assets = fixture("assets.json")["GET /api/assets"];
const knowledgeByType = { guideline: guidelines, term: terms, fact: facts };

for (const [name, records] of Object.entries({
  guidelines,
  terms,
  facts,
  assets,
})) {
  assertUniqueIds(records, name);
}
assertUniqueIds(review.findings, "review findings");
assertUniqueIds(audit, "audit events");
assert.equal(auditContentId, content.id, "audit endpoint references a different document");

for (const term of terms) {
  assert.ok(
    guidelines.some((guideline) => guideline.id === term.guideline_id),
    `term ${term.id} references missing guideline ${term.guideline_id}`,
  );
}

for (const finding of review.findings) {
  assert.equal(
    finding.content_id,
    content.id,
    `finding ${finding.id} references missing content`,
  );
  const sourceRecords = knowledgeByType[finding.source?.type];
  assert.ok(
    sourceRecords?.some((record) => record.id === finding.source.id),
    `finding ${finding.id} references a missing knowledge record`,
  );
}

for (const event of audit) {
  assert.equal(Number.isFinite(Date.parse(event.at)), true, `audit event ${event.id} has an invalid timestamp`);
  assert.equal(
    new Date(event.at).toISOString().replace(".000Z", "Z"),
    event.at,
    `audit event ${event.id} timestamp is not normalized ISO 8601`,
  );
  assert.equal(typeof event.actor, "string", `audit event ${event.id} has no actor`);
  assert.equal(typeof event.role, "string", `audit event ${event.id} has no role`);
}

console.log(
  `Mock fixture integrity passed: ${guidelines.length} guidelines, ${terms.length} terms, ${facts.length} facts, ${assets.length} assets, ${review.findings.length} cited findings, and ${audit.length} content-scoped audit events.`,
);
