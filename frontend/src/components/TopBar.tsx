"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canViewReviewQueue } from "@/lib/workflow";
import { useRole } from "@/lib/role";
import RoleSwitcher from "./RoleSwitcher";

const NAV = [
  { href: "/", label: "Home", key: "home" },
  { href: "/editor", label: "Write & Review", key: "editor" },
  { href: "/knowledge?tab=guidelines", label: "Guidelines", key: "guidelines" },
  { href: "/queue", label: "Review queue", key: "queue" },
  { href: "/audit", label: "Audit Trail", key: "audit" },
];

export default function TopBar() {
  const pathname = usePathname();
  const { role, user, label } = useRole();
  const visibleNav = NAV.filter(
    (item) => item.key !== "queue" || canViewReviewQueue(role),
  );

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
                  ? pathname === "/editor" || pathname.startsWith("/editor/")
                  : item.key === "guidelines"
                    ? pathname === "/knowledge"
                    : item.key === "queue"
                      ? pathname === "/queue" || pathname.startsWith("/queue/")
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
          <strong>{user.replace(/\s+\([^)]*\)$/, "")}</strong>
          <span>{label} · demo role, not authentication</span>
        </span>
        <RoleSwitcher />
      </div>
    </aside>
  );
}
