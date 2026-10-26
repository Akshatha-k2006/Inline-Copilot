"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import RoleSwitcher from "./RoleSwitcher";

const NAV = [
  { href: "/knowledge", label: "Knowledge base" },
  { href: "/editor", label: "Editor" },
  { href: "/queue", label: "Review queue" },
  { href: "/audit", label: "Audit" },
];

export default function TopBar() {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden="true">
          IC
        </span>
        <span className="brand-name">Inline Copilot</span>
      </Link>

      <nav className="nav" aria-label="Main">
        <ul>
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
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

      <RoleSwitcher />
    </header>
  );
}
