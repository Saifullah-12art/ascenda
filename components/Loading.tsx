// A small, reusable loading state shown while a screen's data is fetching.
// Centered on a full-height white screen with a subtle purple spinner, so
// pages show a clear "loading" cue instead of a blank flash. Mobile-first.
export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <span
        role="status"
        aria-label="Loading"
        className="h-7 w-7 animate-spin rounded-full border-2 border-[#EEEDFE] border-t-[#534AB7]"
      />
    </main>
  );
}
