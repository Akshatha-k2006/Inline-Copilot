import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataFile = path.join(directory, "mock-kb-data.json");
const collections = {
  guidelines: ["title", "description"],
  glossary: ["term", "definition", "preferredTerm"],
  facts: ["claim", "owner", "reviewDate"],
  assets: ["name", "description"],
};
const emptyBrand = () => ({
  guidelines: [],
  glossary: [],
  facts: [],
  assets: [],
});

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Role, X-User",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  response.end(JSON.stringify(value));
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: code, message });
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) {
      throw Object.assign(new Error("Request body is too large."), {
        status: 413,
        code: "body_too_large",
      });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      status: 400,
      code: "invalid_json",
    });
  }
}

function validateEntry(collection, value) {
  const required = collections[collection];
  if (!required || !value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (!required.every((field) => typeof value[field] === "string" && value[field].trim())) {
    return false;
  }
  if (
    collection === "facts" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewDate)
  ) {
    return false;
  }
  if (collection === "assets" && value.url !== undefined && typeof value.url !== "string") {
    return false;
  }
  return true;
}

function validateBrand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(collections).every(
    (collection) =>
      Array.isArray(value[collection]) &&
      value[collection].every((item) => validateEntry(collection, item)),
  );
}

export function createServer(dataFile = defaultDataFile) {
  let queue = Promise.resolve();
  const serialize = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };

  async function load() {
    try {
      const text = await readFile(dataFile, "utf8");
      const value = JSON.parse(text);
      if (!validateBrand(value)) throw new Error("Mock database has an invalid shape.");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyBrand();
      throw error;
    }
  }

  async function persist(value) {
    await mkdir(path.dirname(dataFile), { recursive: true });
    const temporary = `${dataFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, dataFile);
  }

  return createHttpServer(async (request, response) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Role, X-User",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/brand/sample") {
        const brand = await readBody(request);
        if (!validateBrand(brand)) {
          sendError(response, 400, "invalid_brand", "Sample brand data is invalid.");
          return;
        }
        await serialize(() => persist(brand));
        sendJson(response, 200, brand);
        return;
      }

      const match = url.pathname.match(/^\/api\/(guidelines|glossary|facts|assets)(?:\/([^/]+))?$/);
      if (!match) {
        sendError(response, 404, "not_found", "Route not found.");
        return;
      }
      const [, collection, encodedId] = match;
      let id;
      try {
        id = encodedId === undefined ? undefined : decodeURIComponent(encodedId);
      } catch {
        sendError(response, 400, "invalid_id", "The entry id is invalid.");
        return;
      }

      await serialize(async () => {
        const brand = await load();

        if (request.method === "GET" && id === undefined) {
          sendJson(response, 200, brand[collection]);
          return;
        }

        if (request.method === "POST" && id === undefined) {
          const entry = await readBody(request);
          if (!validateEntry(collection, entry)) {
            sendError(response, 400, "invalid_entry", "The entry is missing required fields.");
            return;
          }
          const created = { ...entry, id: randomUUID() };
          brand[collection].push(created);
          await persist(brand);
          sendJson(response, 201, created);
          return;
        }

        const index = brand[collection].findIndex((entry) => entry.id === id);
        if (index < 0) {
          sendError(response, 404, "entry_not_found", "The requested entry does not exist.");
          return;
        }

        if (request.method === "PUT" && id !== undefined) {
          const entry = await readBody(request);
          if (!validateEntry(collection, entry)) {
            sendError(response, 400, "invalid_entry", "The entry is missing required fields.");
            return;
          }
          const updated = { ...entry, id };
          brand[collection][index] = updated;
          await persist(brand);
          sendJson(response, 200, updated);
          return;
        }

        if (request.method === "DELETE" && id !== undefined) {
          brand[collection].splice(index, 1);
          await persist(brand);
          response.writeHead(204, headers);
          response.end();
          return;
        }

        sendError(response, 405, "method_not_allowed", "Method not allowed.");
      });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const code = typeof error?.code === "string" ? error.code : "internal_error";
      const message =
        status === 500 ? "The mock knowledge service encountered an error." : error.message;
      sendError(response, status, code, message);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8000);
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Mock knowledge API listening on http://localhost:${port}`);
  });
}
