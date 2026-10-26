import type { Health, Role } from "./types";
import { DEFAULT_ROLE, ROLE_STORAGE_KEY, isRole, optionFor } from "./roles";

/** Backend base URL, from NEXT_PUBLIC_API_URL (no trailing slash). */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

/* ------------------------------------------------------------------ */
/* Current role (demo mode, no login)                                  */
/* ------------------------------------------------------------------ */

let currentRole: Role | null = null;

/** The role sent with every request. Reads the saved choice on first use. */
export function getRole(): Role {
  if (currentRole) return currentRole;
  try {
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (isRole(saved)) {
      currentRole = saved;
      return saved;
    }
  } catch {
    // No window (server render) or storage blocked: fall back to the default.
  }
  return DEFAULT_ROLE;
}

/** Change the role used by every later request, and remember it. */
export function setRole(role: Role): void {
  currentRole = role;
  try {
    window.localStorage.setItem(ROLE_STORAGE_KEY, role);
  } catch {
    // Storage may be blocked (private window). The in-memory role still works.
  }
}

/** Header values must be plain ASCII. */
function asciiHeader(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Matches the contract: { "error": "short_code", "message": "..." } */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const option = optionFor(getRole());
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Role": option.role,
    "X-User": asciiHeader(option.user),
  };

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // the browser sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const url = `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: payload,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the server. It may be waking up, so try again in a moment.",
    );
  }

  if (!res.ok) {
    let code = "http_error";
    let message = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data && typeof data === "object") {
        if (typeof data.error === "string") code = data.error;
        if (typeof data.message === "string") message = data.message;
      }
    } catch {
      // Body was not JSON; keep the generic message.
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Use this for every backend call. Paths start with /api (see the contract). */
export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  health: () => request<Health>("GET", "/api/health"),
};
