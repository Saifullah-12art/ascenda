// Derives a contextual emoji icon + soft background tint from a task's name,
// so each row in Today reads like a polished habit app without any schema or
// data change. The icon is computed purely from the (free-text) name at render
// time and stored nowhere — so AI-generated and hand-added tasks both get one.
//
// To extend: add a rule to RULES below. Order matters — the first matching rule
// wins, so put more specific keywords (e.g. "breakfast") before broader ones
// (e.g. "meal"/"eat"). Anything unmatched falls through to DEFAULT_ICON.

export type TaskIcon = {
  // The emoji to render in the tile.
  emoji: string;
  // A Tailwind background class for the soft tint behind the emoji.
  tint: string;
};

type IconRule = {
  // Lowercase keywords; if any appears in the (lowercased) task name, match.
  keywords: string[];
  icon: TaskIcon;
};

// Soft, flat tints that sit alongside the brand purple (#534AB7). These are the
// 50-weight Tailwind colors so the tiles stay light and shadow-free.
const RULES: IconRule[] = [
  { keywords: ["water", "drink", "hydrate"], icon: { emoji: "💧", tint: "bg-blue-50" } },
  {
    keywords: ["workout", "exercise", "gym", "run", "cardio", "training"],
    icon: { emoji: "🏋️", tint: "bg-green-50" },
  },
  { keywords: ["walk"], icon: { emoji: "🚶", tint: "bg-green-50" } },
  { keywords: ["stretch", "yoga", "mobility"], icon: { emoji: "🧘", tint: "bg-teal-50" } },
  { keywords: ["shower", "freshen"], icon: { emoji: "🚿", tint: "bg-sky-50" } },
  { keywords: ["breakfast"], icon: { emoji: "🍳", tint: "bg-amber-50" } },
  { keywords: ["lunch"], icon: { emoji: "🥗", tint: "bg-amber-50" } },
  { keywords: ["dinner"], icon: { emoji: "🍽️", tint: "bg-amber-50" } },
  // General eating, after the specific meals above.
  { keywords: ["meal", "eat", "nutrition"], icon: { emoji: "🍽️", tint: "bg-amber-50" } },
  {
    keywords: ["work", "study", "focus", "project", "deep"],
    icon: { emoji: "💻", tint: "bg-purple-50" },
  },
  { keywords: ["read", "book"], icon: { emoji: "📖", tint: "bg-orange-50" } },
  {
    keywords: ["meditate", "mindful", "gratitude", "reflect", "journal"],
    icon: { emoji: "📝", tint: "bg-rose-50" },
  },
  { keywords: ["sleep", "bed", "wind-down"], icon: { emoji: "🌙", tint: "bg-indigo-50" } },
  { keywords: ["plan", "prepare"], icon: { emoji: "📝", tint: "bg-rose-50" } },
];

// Used for any task name that matches no rule above.
const DEFAULT_ICON: TaskIcon = { emoji: "✨", tint: "bg-[#EEEDFE]" };

// Returns the icon + tint for a task name via case-insensitive keyword matching,
// falling back to DEFAULT_ICON for anything unmatched.
export function taskIcon(name: string): TaskIcon {
  const lower = name.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.icon;
    }
  }
  return DEFAULT_ICON;
}
