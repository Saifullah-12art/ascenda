// A small, reusable loading state shown while a screen's data is fetching.
// Centered on the full-height app canvas with a soft purple spinner, so pages
// show a clear "loading" cue instead of a blank flash. Mobile-first.
//
// The spinner uses `purple-soft` rather than the brand `purple`, matching
// mobile's ActivityIndicator: the denser purple goes muddy against a near-black
// page at this stroke width.
export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page">
      <span
        role="status"
        aria-label="Loading"
        className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-purple-soft"
      />
    </main>
  );
}
