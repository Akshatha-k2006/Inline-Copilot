"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRole } from "@/lib/role";
import RoleSwitcher from "./RoleSwitcher";

const NAV = [
  { href: "/", label: "Home", key: "home" },
  { href: "/editor", label: "Write & Review", key: "editor" },
  {
    href: "/knowledge?tab=guidelines",
    label: "Guidelines",
    key: "guidelines",
  },
  { href: "/audit", label: "Audit Trails", key: "audit" },
];

export default function TopBar() {
  const pathname = usePathname();
  const { role, user, label } = useRole();
  const visibleNav = NAV.map((item) =>
    item.key === "editor" && role === "reviewer"
      ? { ...item, href: "/queue" }
      : item,
  );
  const isDevelopment = process.env.NODE_ENV === "development";

  return (
    <aside className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden="true">
          Co
        </span>
        <span className="brand-copy">
          <span className="brand-name">CoRESpace</span>
          <span className="brand-subtitle">Inline Copilot</span>
        </span>
      </Link>

      <nav className="nav" aria-label="Main">
        <ul>
          {visibleNav.map((item) => {
            const active =
              item.key === "home"
                ? pathname === "/"
                : item.key === "editor"
                  ? pathname === "/editor" ||
                    pathname.startsWith("/editor/") ||
                    pathname === "/queue" ||
                    pathname.startsWith("/queue/")
                  : item.key === "guidelines"
                    ? pathname === "/knowledge"
                    : pathname === "/audit" || pathname.startsWith("/audit/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={active ? "nav-link active" : "nav-link"}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-profile">
        <span className="profile-avatar" aria-hidden="true">A</span>
        <span className="profile-details">
          <strong>
            {isDevelopment
              ? user.replace(/\s+\([^)]*\)$/, "")
              : "Authentication unavailable"}
          </strong>
          <span>
            {isDevelopment
              ? `${label} · local development role, not authentication`
              : "Production API access is disabled until authentication is configured."}
          </span>
        </span>
        {isDevelopment && <RoleSwitcher />}
      </div>
    </aside>
  );
}
