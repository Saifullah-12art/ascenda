// The dark theme — the web mirror of the mobile app's single source of truth
// (ascenda-mobile/src/theme/dark.ts). Every value here is byte-identical to its
// mobile counterpart, so the two surfaces never drift.
//
// You should rarely need to import from this file. The tokens are exposed as
// CSS variables in app/globals.css and as semantic Tailwind color names in
// tailwind.config.ts, and screens are written against those — `bg-card`,
// `text-ink-2`, `border-line` — never against a hex literal. Reach for this
// module only where a raw string is unavoidable: an SVG `stroke` attribute, a
// canvas fill, a value passed to a third-party component.
//
// THE ONE RULE — purple means IMPORTANCE, not decoration.
// It marks the active tab, a selected item, a primary CTA, a hero surface and
// the signed-in user's own row. Everything else — the ordinary card, the list,
// the settings row — is dark navy (`card` / `raised`) with a `line` hairline.
// A screen where every card is purple has said nothing.
//
// And ordinary cards are separated by their border, not by a shadow. A soft
// black shadow on a near-black page is invisible; the hairline does the work.
// `glows.purple` / `glows.hero` exist for the surface that genuinely needs to
// float, and nothing else.

export const dark = {
  // ---------------------------------------------------------------- surfaces
  bg: {
    page: "#070B16", // the app canvas, darkest layer
    secondary: "#0B1020", // a section band sitting just above the page
    card: "#101625", // the default card — most cards are this
    raised: "#151B2C", // a card on a card (tiles, inset rows, inputs)
    softPurple: "#191630", // a purple-tinted surface for a *marked* card only
    nav: "#090E1A", // the tab bar's own surface
  },

  // ------------------------------------------------------------------ purple
  purple: {
    primary: "#7048FF", // the brand purple: CTAs, active state, bars
    bright: "#8B5CFF", // the lighter stop / today's bar / hover-ish accent
    soft: "#A78BFA", // purple *text* on dark, where primary is too dense
    deep: "#4B2BCE", // the darker stop, gradient tails
    glow: "rgba(112,72,255,0.28)", // the halo color for borders/overlays
  },

  // -------------------------------------------------------------------- text
  text: {
    primary: "#F7F8FC", // headings, values, row labels
    secondary: "#A1A8BA", // supporting copy, captions
    muted: "#70788D", // overlines, timestamps, chevrons, disabled
    // The tab bar's resting label/glyph. One step brighter than `muted` —
    // a nav item is always readable, never a disabled-looking hint.
    navInactive: "#858DA1",
  },

  // ----------------------------------------------------------------- borders
  border: {
    default: "#242B3D", // every ordinary card and divider
    purple: "#6040E8", // the outline of a *marked* surface
    navTop: "#1B2231", // the tab bar's top hairline
  },

  // ---------------------------------------------------------------- semantic
  semantic: {
    success: "#24D17E",
    warning: "#FFB020",
    danger: "#FF4965",
    // A calmer red for destructive *text* (sign out). Full danger red on a
    // near-black page shouts louder than the action deserves.
    dangerMuted: "#E8536B",
  },

  // Translucent fills for the small icon tiles and chips that sit on a dark
  // card. Alpha rather than a mixed hex, so one tint works on `card`,
  // `raised` and `page` alike.
  tint: {
    purple: "rgba(112,72,255,0.16)",
    success: "rgba(36,209,126,0.14)",
    warning: "rgba(255,176,32,0.14)",
    danger: "rgba(255,73,101,0.14)",
    // The neutral track behind a progress bar / chart column.
    track: "rgba(255,255,255,0.06)",
  },
} as const;

// Gradients. Mobile passes these to LinearGradient as top-left → bottom-right
// tuples; on the web the same stops become a 135deg CSS gradient, which is the
// same axis. Available as `bg-gradient-primary` / `bg-gradient-hero`.
export const gradients = {
  // The primary button / avatar / any purple CTA surface.
  primaryButton: "linear-gradient(135deg, #5B4CF4, #7048FF, #8B5CFF)",
  // A hero surface: navy lifting into the brand purple. Used with `glows.hero`
  // so the card reads as the one important thing on its screen.
  hero: "linear-gradient(135deg, #101625, #241A52, #4B2BCE)",
} as const;

// Corner radii — small controls, chips/tiles, cards, hero.
//
// `sm` and `md` already exist in Tailwind as `rounded-xl` (12px) and
// `rounded-2xl` (16px), so only `panel` / `card` / `hero` are registered as new
// utilities. Redefining `rounded-sm/md/lg` would silently resize every button
// on the screens still awaiting conversion.
export const radii = {
  sm: 12,
  md: 16,
  lg: 20,
  card: 24,
  hero: 28,
  pill: 999,
} as const;

// 4pt-based spacing scale, matching mobile. Tailwind's own scale is already
// 4pt-based (`p-1` = 4px … `p-8` = 32px), so these are here for parity and for
// the rare inline value, not as new utilities.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
} as const;

// The purple glow — the marker of an important surface. Radius 16–20 at
// 0.20–0.25 opacity; anything heavier turns into a bloom on a near-black page.
// Available as `shadow-glow` / `shadow-glow-hero`.
export const glows = {
  // A purple control or small surface (button, avatar tile).
  purple: "0 6px 16px rgba(112,72,255,0.20)",
  // A hero card — the same glow, one step wider.
  hero: "0 10px 20px rgba(112,72,255,0.25)",
} as const;
