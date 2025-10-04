// stats-today.ts
// Shows today's guesses (Oct 4, 2025) grouped by user email.
// Prints: email: TOTAL (CORRECT)
// A guess is "correct" if Number(pointsAwarded) !== 0.

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  Timestamp,
} from "firebase/firestore";

import { loadDbFromConfig } from "./loadDbFromConfig";

const db = loadDbFromConfig(); // ← uses firebaseConfig.ts on disk

// ===== Time helpers (America/Indiana/Indianapolis) =====
function tzOffsetMsAt(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const wallUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
    0
  );
  return wallUTC - date.getTime();
}

function dayRangeUTC(
  year: number,
  month1Based: number,
  day: number,
  timeZone = "America/Indiana/Indiana polis" // typo? keep correct tz below
): { start: Date; end: Date } {
  // Fix timezone string (typo safeguard)
  const tz = "America/Indiana/Indianapolis";
  const probe = new Date(Date.UTC(year, month1Based - 1, day, 12, 0, 0));
  const offsetMs = tzOffsetMsAt(probe, tz);
  const localMidnightUTCms = Date.UTC(year, month1Based - 1, day, 0, 0, 0) - offsetMs;
  const nextMidnightUTCms = Date.UTC(year, month1Based - 1, day + 1, 0, 0, 0) - offsetMs;
  return { start: new Date(localMidnightUTCms), end: new Date(nextMidnightUTCms) };
}

// ===== User email lookup with cache =====
const emailCache = new Map<string, string>();

async function getUserEmail(db: any, playerId: string | undefined | null): Promise<string> {
  if (!playerId) return "(no playerId)";
  if (emailCache.has(playerId)) return emailCache.get(playerId)!;

  try {
    const ref = doc(collection(db, "users"), playerId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      const email = data?.email ?? "(no email)";
      emailCache.set(playerId, email);
      return email;
    } else {
      emailCache.set(playerId, "(not found)");
      return "(not found)";
    }
  } catch (e) {
    console.error(`Failed to fetch users/${playerId}:`, e);
    return "(error)";
  }
}

// ===== Main =====
(async () => {

  // Fixed date: Oct 4, 2025 in America/Indiana/Indianapolis
  const { start, end } = dayRangeUTC(2025, 10, 4, "America/Indiana/Indianapolis");
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  console.log(
    `Counting guesses for local day 2025-10-04 [${start.toISOString()} .. ${end.toISOString()}) in America/Indiana/Indianapolis`
  );

  const q = query(
    collection(db, "guesses"),
    where("submittedAt", ">=", startTs),
    where("submittedAt", "<", endTs)
  );

  let snap;
  try {
    snap = await getDocs(q);
  } catch (err) {
    console.error(
      "Query by submittedAt failed. Ensure 'submittedAt' is a Firestore Timestamp in all docs.",
      err
    );
    process.exit(1);
  }

  // Aggregation: email -> { total, correct }
  const stats = new Map<string, { total: number; correct: number }>();

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;
    const email = await getUserEmail(db, data?.playerId);
    const entry = stats.get(email) ?? { total: 0, correct: 0 };
    entry.total += 1;

    // Robust correct check: treat missing/NaN as 0; correct iff !== 0
    const pa = Number(data?.pointsAwarded ?? 0);
    if (!Number.isNaN(pa) && pa !== 0) entry.correct += 1;

    stats.set(email, entry);
  }

  const rows = Array.from(stats.entries()).sort((a, b) => {
    const diff = b[1].total - a[1].total;
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });

  if (rows.length === 0) {
    console.log("No guesses found for 2025-10-04.");
    return;
  }

  console.log("\nGuesses by email for 2025-10-04 (local):\n");
  for (const [email, { total, correct }] of rows) {
    // Always show parentheses, even if correct === 0
    console.log(`${email}: ${total} (${correct})`);
  }
})();
