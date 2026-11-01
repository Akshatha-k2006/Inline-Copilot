"use client";

import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role";
import { isRole, ROLE_OPTIONS } from "@/lib/roles";

export default function RoleSwitcher() {
  const { role, setRole } = useRole();
  const router = useRouter();

  return (
    <label className="role-switcher">
      <span className="role-label">Demo role</span>
      <select
        className="role-select"
        value={role}
        onChange={(event) => {
          const next = event.target.value;
          if (isRole(next)) {
            setRole(next);
            router.push("/");
          }
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
