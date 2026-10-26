import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "./mock_kb.mjs";

async function startServer(dataFile) {
  const server = createServer(dataFile);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start test server.");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function jsonRequest(baseUrl, method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = response.status === 204 ? undefined : await response.json();
  return { response, value };
}

const directory = await mkdtemp(path.join(os.tmpdir(), "inline-copilot-kb-"));
const dataFile = path.join(directory, "brand.json");
let running = await startServer(dataFile);

try {
  const { response: healthResponse, value: health } = await jsonRequest(
    running.baseUrl,
    "GET",
    "/api/health",
  );
  assert.equal(healthResponse.status, 200);
  assert.equal(health.status, "ok");

  const { value: initial } = await jsonRequest(
    running.baseUrl,
    "GET",
    "/api/guidelines",
  );
  assert.deepEqual(initial, []);

  const { response: createdResponse, value: created } = await jsonRequest(
    running.baseUrl,
    "POST",
    "/api/guidelines",
    { title: "Write clearly", description: "Use plain language." },
  );
  assert.equal(createdResponse.status, 201);
  assert.ok(created.id);

  const { value: updated } = await jsonRequest(
    running.baseUrl,
    "PUT",
    `/api/guidelines/${created.id}`,
    { title: "Write clearly", description: "Use short, plain sentences." },
  );
  assert.equal(updated.description, "Use short, plain sentences.");
  const { value: afterRefresh } = await jsonRequest(
    running.baseUrl,
    "GET",
    "/api/guidelines",
  );
  assert.equal(afterRefresh[0].description, "Use short, plain sentences.");

  const sample = {
    guidelines: [{ id: "s-g", title: "Sample guideline", description: "Be clear." }],
    glossary: [{ id: "s-t", term: "Preferred", definition: "Use this.", preferredTerm: "Preferred" }],
    facts: [{ id: "s-f", claim: "Founded in 2020.", owner: "Brand", reviewDate: "2025-01-15" }],
    assets: [{ id: "s-a", name: "Logo", description: "Primary logo.", url: "" }],
  };
  const { response: sampleResponse } = await jsonRequest(
    running.baseUrl,
    "POST",
    "/api/brand/sample",
    sample,
  );
  assert.equal(sampleResponse.status, 200);
  for (const collection of Object.keys(sample)) {
    const { value } = await jsonRequest(running.baseUrl, "GET", `/api/${collection}`);
    assert.equal(value.length, 1);
  }

  const { response: deleteResponse } = await jsonRequest(
    running.baseUrl,
    "DELETE",
    "/api/assets/s-a",
  );
  assert.equal(deleteResponse.status, 204);
  await running.close();
  running = await startServer(dataFile);
  const { value: persistedAfterRestart } = await jsonRequest(
    running.baseUrl,
    "GET",
    "/api/guidelines",
  );
  assert.deepEqual(persistedAfterRestart, sample.guidelines);
  const { value: deletedAfterRestart } = await jsonRequest(
    running.baseUrl,
    "GET",
    "/api/assets",
  );
  assert.deepEqual(deletedAfterRestart, []);

  console.log("Knowledge API CRUD, sample loading, refresh, and restart persistence checks passed.");
} finally {
  await running.close();
  await rm(directory, { recursive: true, force: true });
}
