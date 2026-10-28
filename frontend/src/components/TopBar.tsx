"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRole } from "@/lib/role";
import RoleSwitcher from "./RoleSwitcher";

const NAV = [
  { href: "/", label: "Home", key: "home" },
  { href: "/editor", label: "Inline Editor", key: "editor" },
  {
    href: "/knowledge?tab=guidelines",
    label: "Guidelines",
    key: "guidelines",
  },
  { href: "/queue", label: "Review Queue", key: "queue" },
  { href: "/audit", label: "Audit Trail", key: "audit" },
];

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, user, label, isRoleLoaded } = useRole();
  const visibleNav = NAV.filter((item) => {
    if (item.key === "queue") return role !== "creator";
    if (item.key === "audit") return role === "admin" || role === "brand_manager";
    return true;
  });

  useEffect(() => {
    if (!isRoleLoaded) return;
    if (role === "creator" && (pathname === "/queue" || pathname === "/audit")) {
      router.replace("/");
    } else if (
      role !== "admin" &&
      role !== "brand_manager" &&
      pathname === "/audit"
    ) {
      router.replace("/");
    }
  }, [isRoleLoaded, pathname, role, router]);

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
        <span className="profile-avatar" aria-hidden="true">{(user.replace(/\s+\([^)]*\)$/, "") || "A").charAt(0).toUpperCase()}</span>
        <span className="profile-details">
          <strong>
            {user.replace(/\s+\([^)]*\)$/, "") || "User"}
          </strong>
          <span>
            {label} · demo role
          </span>
        </span>
        <RoleSwitcher />
      </div>
    </aside>
  );
}
