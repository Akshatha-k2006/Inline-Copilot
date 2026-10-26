"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { getRole, setRole as saveRole } from "./api";
import { DEFAULT_ROLE, optionFor } from "./roles";
import type { Role } from "./types";

interface RoleContextValue {
  role: Role;
  label: string;
  user: string;
  setRole: (role: Role) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  // Start from the default so server and browser render the same thing,
  // then switch to the saved role once the page has loaded.
  const [role, setRoleState] = useState<Role>(DEFAULT_ROLE);

  useEffect(() => {
    setRoleState(getRole());
  }, []);

  const setRole = useCallback((next: Role) => {
    saveRole(next);
    setRoleState(next);
  }, []);

  const value = useMemo<RoleContextValue>(() => {
    const option = optionFor(role);
    return { role, label: option.label, user: option.user, setRole };
  }, [role, setRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}
