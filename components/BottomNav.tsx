"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The main tabs. `match` is the route each tab is active on.
const TABS = [
  { href: "/today", label: "Today", match: "/today" },
  { href: "/feed", label: "Feed", match: "/feed" },
  { href: "/leaderboard", label: "Leaderboard", match: "/leaderboard" },
  { href: "/profile", label: "Profile", match: "/profile" },
] as const;

// Each tab's icon, keyed by href. Inherits color via `currentColor`.
function TabIcon({ href }: { href: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (href === "/today") {
    // Sun — the daily routine.
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (href === "/feed") {
    // Stacked cards — the feed of posts.
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="6" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
      </svg>
    );
  }
  if (href === "/leaderboard") {
    // Trophy — the ranking.
    return (
      <svg {...common}>
        <path d="M6 4h12v3a6 6 0 0 1-12 0V4z" />
        <path d="M6 5H4a2 2 0 0 0 0 4h2M18 5h2a2 2 0 0 1 0 4h-2" />
        <path d="M12 13v4M9 21h6M10 21v-2h4v2" />
      </svg>
    );
  }
  // Person — the profile.
  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 border-t-[0.5px] border-gray-200 bg-white">
      {/* Center the tab content to match the app's ~400px column on wide screens */}
      <div className="mx-auto flex max-w-[400px] items-stretch justify-around">
        {TABS.map((tab) => {
          // Active when the current path is (or sits under) the tab's route.
          const active =
            pathname === tab.match || pathname.startsWith(tab.match + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 ${
                active ? "text-[#534AB7]" : "text-gray-400"
              }`}
            >
              <TabIcon href={tab.href} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
