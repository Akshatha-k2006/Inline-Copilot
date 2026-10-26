"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import RoleSwitcher from "./RoleSwitcher";

const NAV = [
  { href: "/", label: "Home", key: "home" },
  { href: "/editor", label: "Write & Review", key: "editor" },
  { href: "/knowledge?tab=guidelines", label: "Guidelines", key: "guidelines" },
  { href: "/knowledge?tab=assets", label: "Facts & Assets", key: "knowledge" },
  { href: "/audit", label: "Review History", key: "audit" },
];

export default function TopBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
          {NAV.map((item) => {
            const knowledgeTab = searchParams.get("tab");
            const active =
              item.key === "home"
                ? pathname === "/"
                : item.key === "editor"
                  ? pathname === "/editor" || pathname.startsWith("/editor/")
                  : item.key === "knowledge"
                    ? pathname === "/knowledge" && knowledgeTab === "assets"
                    : item.key === "guidelines"
                      ? pathname === "/knowledge" && knowledgeTab !== "assets"
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
          <strong>Asha</strong>
          <span>Demo workspace</span>
        </span>
        <RoleSwitcher />
      </div>
    </aside>
  );
}
