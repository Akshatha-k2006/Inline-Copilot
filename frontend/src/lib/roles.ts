import type { Role } from "./types";

export interface RoleOption {
  role: Role;
  label: string;
  /** Demo actor used for content ownership and audit attribution, not identity. */
  user: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
  { role: "creator", label: "Creator", user: "Asha (Creator)" },
  { role: "reviewer", label: "Reviewer", user: "Ravi (Reviewer)" },
  {
    role: "brand_manager",
    label: "Brand Manager",
    user: "Bhavana (Brand Manager)",
  },
  { role: "admin", label: "Admin", user: "Admin" },
];

export const DEFAULT_ROLE: Role = "creator";

export const ROLE_STORAGE_KEY = "inline-copilot-role";

export function isRole(value: unknown): value is Role {
  return ROLE_OPTIONS.some((o) => o.role === value);
}

export function optionFor(role: Role): RoleOption {
  return ROLE_OPTIONS.find((o) => o.role === role) ?? ROLE_OPTIONS[0];
}
