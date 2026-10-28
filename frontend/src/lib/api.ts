import type {
  ApiAsset,
  ApiFact,
  ApiGlossaryTerm,
  ApiGuideline,
  ContentCommentsResponse,
  Content,
  ContentAuditEvent,
  ContentDraft,
  ContentFindingsResponse,
  ContentUpdate,
  ContentStatusResponse,
  FindingActionResponse,
  Health,
  ReviewComment,
  ReviewDecisionResponse,
  ReviewResponse,
  Role,
  SeedResponse,
} from "./types";
import { DEFAULT_ROLE, ROLE_STORAGE_KEY, isRole, optionFor } from "./roles";

/** Public backend URL, configured at build time with NEXT_PUBLIC_API_BASE_URL. */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

let currentRole: Role | null = null;

export function getRole(): Role {
  if (currentRole) return currentRole;
  try {
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (isRole(saved)) {
      currentRole = saved;
      return saved;
    }
  } catch {
    // Server rendering or blocked storage uses the default role.
  }
  return DEFAULT_ROLE;
}

export function setRole(role: Role): void {
  currentRole = role;
  try {
    window.localStorage.setItem(ROLE_STORAGE_KEY, role);
  } catch {
    // The in-memory role remains available when storage is blocked.
  }
}

function asciiHeader(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  signal?: AbortSignal;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function defaultErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Please sign in and try again.";
    case 403:
      return "You do not have permission to perform this action.";
    case 404:
      return "The requested resource could not be found.";
    case 409:
      return "This action conflicts with the current server state. Refresh and try again.";
    case 422:
      return "The submitted data is invalid. Check the fields and try again.";
    case 500:
      return "The server could not complete the request. Please try again later.";
    default:
      return `Request failed (${status}).`;
  }
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const option = optionFor(getRole());
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Role": option.role,
    "X-User": asciiHeader(option.user),
  };

  let payload: BodyInit | undefined;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const url = `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: payload,
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the server. It may be waking up, so try again in a moment.",
    );
  }

  if (!response.ok) {
    let code = "http_error";
    let message = defaultErrorMessage(response.status);
    try {
      const data: unknown = await response.json();
      if (data && typeof data === "object") {
        const errorBody = data as Record<string, unknown>;
        const detail =
          data && typeof errorBody.detail === "object" && errorBody.detail
            ? (errorBody.detail as Record<string, unknown>)
            : errorBody;
        if (typeof detail.error === "string") code = detail.error;
        if (typeof detail.message === "string") {
          message = detail.message;
        }
      }
    } catch {
      // Non-JSON error bodies use the status-specific message above.
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Centralized requests to implemented backend routes. */
export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>("DELETE", path, undefined, options),

  health: (options?: RequestOptions) =>
    request<Health>("GET", "/api/health", undefined, options),
  seedSample: () => request<SeedResponse>("POST", "/api/seed/load"),

  listGuidelines: (options?: RequestOptions) =>
    request<ApiGuideline[]>("GET", "/api/guidelines", undefined, options),
  createGuideline: (body: Omit<ApiGuideline, "id">) =>
    request<ApiGuideline>("POST", "/api/guidelines", body),
  updateGuideline: (id: number, body: Omit<ApiGuideline, "id">) =>
    request<ApiGuideline>("PUT", `/api/guidelines/${id}`, body),
  deleteGuideline: (id: number) =>
    request<void>("DELETE", `/api/guidelines/${id}`),

  listGlossary: (options?: RequestOptions) =>
    request<ApiGlossaryTerm[]>("GET", "/api/glossary", undefined, options),
  createGlossaryTerm: (body: Omit<ApiGlossaryTerm, "id">) =>
    request<ApiGlossaryTerm>("POST", "/api/glossary", body),
  updateGlossaryTerm: (id: number, body: Omit<ApiGlossaryTerm, "id">) =>
    request<ApiGlossaryTerm>("PUT", `/api/glossary/${id}`, body),
  deleteGlossaryTerm: (id: number) =>
    request<void>("DELETE", `/api/glossary/${id}`),

  listFacts: (options?: RequestOptions) =>
    request<ApiFact[]>("GET", "/api/facts", undefined, options),
  createFact: (body: Omit<ApiFact, "id" | "outdated">) =>
    request<ApiFact>("POST", "/api/facts", body),
  updateFact: (id: number, body: Omit<ApiFact, "id" | "outdated">) =>
    request<ApiFact>("PUT", `/api/facts/${id}`, body),
  deleteFact: (id: number) => request<void>("DELETE", `/api/facts/${id}`),

  listAssets: (options?: RequestOptions) =>
    request<ApiAsset[]>("GET", "/api/assets", undefined, options),
  createAsset: (body: Omit<ApiAsset, "id">) =>
    request<ApiAsset>("POST", "/api/assets", body),
  updateAsset: (id: number, body: Omit<ApiAsset, "id">) =>
    request<ApiAsset>("PUT", `/api/assets/${id}`, body),
  deleteAsset: (id: number) => request<void>("DELETE", `/api/assets/${id}`),

  listContent: (options?: RequestOptions) =>
    request<Content[]>("GET", "/api/content", undefined, options),
  createContent: (body: ContentDraft) =>
    request<Content>("POST", "/api/content", body),
  getContent: (id: number, options?: RequestOptions) =>
    request<Content>("GET", `/api/content/${id}`, undefined, options),
  updateContent: (id: number, body: ContentUpdate) =>
    request<Content>("PUT", `/api/content/${id}`, body),

  reviewContent: (id: number) =>
    request<ReviewResponse>("POST", `/api/content/${id}/review`),
  updateFinding: (
    id: number,
    body: { action: "accept" | "edit" | "dismiss"; replacement?: string },
  ) => request<FindingActionResponse>("PATCH", `/api/findings/${id}`, body),
  submitContent: (id: number) =>
    request<ContentStatusResponse>("POST", `/api/content/${id}/submit`),
  selfCheckContent: (id: number) =>
    request<ContentStatusResponse>("POST", `/api/content/${id}/self-check`),
  getContentFindings: (id: number, options?: RequestOptions) =>
    request<ContentFindingsResponse>(
      "GET",
      `/api/content/${id}/findings`,
      undefined,
      options,
    ),
  getContentAudit: (id: number, options?: RequestOptions) =>
    request<ContentAuditEvent[]>(
      "GET",
      `/api/content/${id}/audit`,
      undefined,
      options,
    ),
  getAudit: (options?: RequestOptions) =>
    request<ContentAuditEvent[]>("GET", "/api/audit", undefined, options),
  decideContent: (
    id: number,
    body: { decision: "approve" | "request_changes"; comment?: string },
  ) =>
    request<ReviewDecisionResponse>(
      "POST",
      `/api/content/${id}/decision`,
      body,
    ),
  markReadyToPublish: (id: number) =>
    request<ContentStatusResponse>(
      "POST",
      `/api/content/${id}/ready-to-publish`,
    ),
  addReviewComment: (id: number, body: { body: string }) =>
    request<ReviewComment>("POST", `/api/content/${id}/comments`, body),
  getReviewComments: (id: number, options?: RequestOptions) =>
    request<ContentCommentsResponse>(
      "GET",
      `/api/content/${id}/comments`,
      undefined,
      options,
    ),
};
