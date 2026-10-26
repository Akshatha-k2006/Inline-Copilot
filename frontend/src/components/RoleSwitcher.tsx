"use client";

import { useRole } from "@/lib/role";
import { isRole, ROLE_OPTIONS } from "@/lib/roles";

export default function RoleSwitcher() {
  const { role, setRole } = useRole();

  return (
    <label className="role-switcher">
      <span className="role-label">Demo role</span>
      <select
        className="role-select"
        value={role}
        onChange={(event) => {
          if (isRole(event.target.value)) setRole(event.target.value);
        }}
        aria-label="Choose demo role"
      >
        {ROLE_OPTIONS.map((option) => (
          <option key={option.role} value={option.role}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
