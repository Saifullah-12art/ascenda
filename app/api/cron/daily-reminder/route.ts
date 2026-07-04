import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

// This route talks to Resend and the Supabase admin API, so it must run on the
// Node.js runtime (not Edge) and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public URL of the app, used for the email links.
const APP_URL = "https://ascenda-omega.vercel.app";

// Local YYYY-MM-DD for "today" — must match how the Today screen writes a
// completion's `date` (see app/today/page.tsx `localToday`). Same format, so
// the equality check against the `completions.date` column lines up.
function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(request: Request) {
  // 1. Authorize. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`
  //    automatically. Reject anything that isn't an exact match so the route
  //    can't be triggered by the public.
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== expected
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = localToday();
  const supabase = createAdminClient();

  // 2. Who is active today: the set of user_ids with a completion row for today.
  const { data: activeRows, error: activeError } = await supabase
    .from("completions")
    .select("user_id")
    .eq("date", today);

  if (activeError) {
    return NextResponse.json({ error: activeError.message }, { status: 500 });
  }
  const activeUserIds = new Set((activeRows ?? []).map((r) => r.user_id as string));

  // 3. Candidate profiles: finished onboarding (onboarding_answers set) and
  //    opted in to reminders. We narrow to non-active + has-a-routine below.
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, onboarding_answers, email_reminders")
    .eq("email_reminders", true)
    .not("onboarding_answers", "is", null);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // 4. Keep only users who have at least one task (a real routine). One query
  //    for all candidate ids, then reduce to the set that owns a task.
  const candidateIds = (profiles ?? []).map((p) => p.id as string);

  let withRoutine = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: taskRows, error: taskError } = await supabase
      .from("tasks")
      .select("user_id")
      .in("user_id", candidateIds);

    if (taskError) {
      return NextResponse.json({ error: taskError.message }, { status: 500 });
    }
    withRoutine = new Set((taskRows ?? []).map((r) => r.user_id as string));
  }

  // Final recipients: opted-in + onboarded + has a routine + NOT active today.
  const recipientIds = candidateIds.filter(
    (id) => withRoutine.has(id) && !activeUserIds.has(id)
  );

  const summaryBase = {
    date: today,
    totalCandidates: candidateIds.length,
    activeToday: activeUserIds.size,
  };

  // 5. Nobody to email — finish cleanly without calling Resend.
  if (recipientIds.length === 0) {
    const summary = { ...summaryBase, toRemind: 0, emailed: 0, failed: 0 };
    console.log("[daily-reminder]", summary);
    return NextResponse.json(summary);
  }

  // 6. Resolve email addresses from Supabase auth, matched to profiles by id.
  //    listUsers is paginated; walk pages until exhausted and index by id.
  const emailById = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const u of data.users) {
      if (u.email) emailById.set(u.id, u.email);
    }
    if (data.users.length < perPage) break; // last page
  }

  // 7. Send each reminder via Resend. We tally successes; a single send failing
  //    is logged but doesn't abort the rest.
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.REMINDER_FROM;
  if (!from) {
    return NextResponse.json(
      { error: "REMINDER_FROM is not configured." },
      { status: 500 }
    );
  }

  let emailed = 0;
  let failed = 0;
  for (const id of recipientIds) {
    const email = emailById.get(id);
    if (!email) continue; // no auth email on file — skip

    const todayUrl = `${APP_URL}/today`;
    const unsubscribeUrl = `${APP_URL}/api/unsubscribe?u=${id}`;

    try {
      const { data, error } = await resend.emails.send({
        from,
        to: email,
        subject: "Your routine is waiting 🌱",
        text: [
          "Hi there,",
          "",
          "You haven't checked off anything today yet. A few minutes on your routine keeps the momentum going.",
          "",
          `Open today's routine: ${todayUrl}`,
          "",
          "— Ascenda",
          "",
          `Don't want these reminders? Unsubscribe: ${unsubscribeUrl}`,
        ].join("\n"),
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">
            <p>Hi there,</p>
            <p>You haven't checked off anything today yet. A few minutes on your
            routine keeps the momentum going.</p>
            <p>
              <a href="${todayUrl}"
                 style="display:inline-block;background:#534AB7;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:500">
                Open today's routine
              </a>
            </p>
            <p style="color:#6b7280">— Ascenda</p>
            <p style="color:#9ca3af;font-size:12px">
              Don't want these reminders?
              <a href="${unsubscribeUrl}" style="color:#9ca3af">Unsubscribe</a>.
            </p>
          </div>
        `,
      });

      // Resend returns { data: { id }, error }. A confirmed send has an `id`
      // and no `error`; anything else (error object, or a response with no id)
      // is a failure and must not be counted as emailed.
      if (error || !data?.id) {
        failed++;
        console.error(
          `[daily-reminder] send failed for ${id} <${email}>:`,
          error ?? "no id returned in response"
        );
      } else {
        emailed++;
      }
    } catch (err) {
      failed++;
      console.error(`[daily-reminder] send threw for ${id} <${email}>:`, err);
    }
  }

  const summary = {
    ...summaryBase,
    toRemind: recipientIds.length,
    emailed,
    failed,
  };
  console.log("[daily-reminder]", summary);
  return NextResponse.json(summary);
}
