import type { Config } from "tailwindcss";

// The dark theme, exposed as semantic utility names. Screens are written
// against these — `bg-card`, `text-ink-2`, `border-line`, `bg-purple` — so the
// palette lives in one place instead of as hex literals spread across pages.
// The values themselves are CSS variables declared in app/globals.css, and
// lib/theme.ts documents what each token is for.
//
// The app is dark-only (mobile deleted its light tokens), so there is no
// `darkMode` strategy and no `dark:` variants — these names *are* the theme.
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces, darkest first. Most cards are `card`; `raised` is a card on
        // a card; `soft-purple` is reserved for a card that is *marked*.
        page: "var(--bg-page)",
        secondary: "var(--bg-secondary)",
        card: "var(--bg-card)",
        raised: "var(--bg-raised)",
        "soft-purple": "var(--bg-soft-purple)",
        nav: "var(--bg-nav)",

        // Purple means importance, not decoration — see lib/theme.ts.
        purple: {
          DEFAULT: "var(--purple)",
          bright: "var(--purple-bright)",
          soft: "var(--purple-soft)",
          deep: "var(--purple-deep)",
          glow: "var(--purple-glow)",
        },

        // Text tones. `ink` for headings and values, `ink-2` for supporting
        // copy, `ink-muted` for overlines and timestamps, `ink-nav` for a
        // resting tab label.
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          muted: "var(--ink-muted)",
          nav: "var(--ink-nav)",
        },

        // Hairlines. `line` separates every ordinary card — a dark card is
        // edged, not shadowed.
        line: {
          DEFAULT: "var(--line)",
          purple: "var(--line-purple)",
          nav: "var(--line-nav)",
        },

        success: "var(--success)",
        warning: "var(--warning)",
        danger: {
          DEFAULT: "var(--danger)",
          muted: "var(--danger-muted)",
        },

        // Translucent fills for small tiles and chips sitting on a dark card,
        // plus the neutral track behind a progress bar or chart column.
        tint: {
          purple: "var(--tint-purple)",
          success: "var(--tint-success)",
          warning: "var(--tint-warning)",
          danger: "var(--tint-danger)",
          track: "var(--tint-track)",
        },
      },

      // Mobile's radii scale. `sm` (12px) and `md` (16px) already exist as
      // Tailwind's `rounded-xl` / `rounded-2xl`, so only the three with no
      // stock equivalent are registered — redefining `rounded-sm/md/lg` would
      // silently resize every button on the screens still awaiting conversion.
      borderRadius: {
        panel: "20px",
        card: "24px",
        hero: "28px",
      },

      // The two gradients from mobile, as 135deg CSS (the same top-left →
      // bottom-right axis LinearGradient uses there).
      backgroundImage: {
        "gradient-primary":
          "linear-gradient(135deg, #5B4CF4, #7048FF, #8B5CFF)",
        "gradient-hero": "linear-gradient(135deg, #101625, #241A52, #4B2BCE)",
      },

      // The purple glow, for a surface that genuinely needs to float. Ordinary
      // cards get a `border-line` hairline instead.
      boxShadow: {
        glow: "0 6px 16px rgba(112,72,255,0.20)",
        "glow-hero": "0 10px 20px rgba(112,72,255,0.25)",
      },

      // Geist, loaded in app/layout.tsx, so `font-sans` / `font-mono` resolve
      // to the fonts the app actually ships.
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
