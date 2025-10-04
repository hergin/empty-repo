// gameStats-today.ts
// Show today's (Oct 4, 2025) gameStats as a console table with: email, totalPoints, totalPredictions.
// Timezone: America/Indiana/Indianapolis
// If email is missing but playerId exists, it fetches users/{playerId}.email.
// It first attempts to query by a timestamp field; if none found/usable, it falls back to printing all docs.

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
  timeZone = "America/Indiana/Indianapolis"
): { start: Date; end: Date } {
  const probe = new Date(Date.UTC(year, month1Based - 1, day, 12, 0, 0));
  const offsetMs = tzOffsetMsAt(probe, timeZone);
  const localMidnightUTCms = Date.UTC(year, month1Based - 1, day, 0, 0, 0) - offsetMs;
  const nextMidnightUTCms = Date.UTC(year, month1Based - 1, day + 1, 0, 0, 0) - offsetMs;
  return { start: new Date(localMidnightUTCms), end: new Date(nextMidnightUTCms) };
}

// ===== User email lookup with cache =====
const emailCache = new Map<string, string>();
async function getUserEmail(db: any, playerId?: string | null): Promise<string> {
  if (!playerId) return "(no playerId)";
  if (emailCache.has(playerId)) return emailCache.get(playerId)!;
  try {
    const ref = doc(collection(db, "users"), playerId);
    const snap = await getDoc(ref);
    const email = snap.exists() ? (snap.data() as any)?.email ?? "(no email)" : "(not found)";
    emailCache.set(playerId, email);
    return email;
  } catch {
    return "(error)";
  }
}

// ===== Console table helper =====
function printTable(rows: Array<{ email: string; totalPoints: number; totalPredictions: number }>) {
  if (!rows.length) {
    console.log("No gameStats found for 2025-10-04.");
    return;
  }

  console.log("There are "+ rows.length+" rows");

  // Sort by totalPoints desc, then email
  rows.sort((a, b) => (b.totalPoints - a.totalPoints) || a.email.localeCompare(b.email));

  const headers = ["email", "totalPoints", "totalPredictions"];
  const colWidths = {
    email: Math.max("email".length, ...rows.map(r => (r.email ?? "").length)),
    totalPoints: Math.max("totalPoints".length, ...rows.map(r => String(r.totalPoints ?? "").length)),
    totalPredictions: Math.max("totalPredictions".length, ...rows.map(r => String(r.totalPredictions ?? "").length)),
  };

  const pad = (s: string, w: number) => s.padEnd(w, " ");

  const headerLine =
    pad(headers[0], colWidths.email) + "  " +
    pad(headers[1], colWidths.totalPoints) + "  " +
    pad(headers[2], colWidths.totalPredictions);

  const sepLine =
    "-".repeat(colWidths.email) + "  " +
    "-".repeat(colWidths.totalPoints) + "  " +
    "-".repeat(colWidths.totalPredictions);

  console.log(headerLine);
  console.log(sepLine);

  for (const r of rows) {
    console.log(
      pad(r.email ?? "", colWidths.email) + "  " +
      pad(String(r.totalPoints ?? ""), colWidths.totalPoints) + "  " +
      pad(String(r.totalPredictions ?? ""), colWidths.totalPredictions)
    );
  }
}

// ===== Main =====
(async () => {

  // Fixed date: Oct 4, 2025 in America/Indiana/Indianapolis
  const { start, end } = dayRangeUTC(2025, 10, 4, "America/Indiana/Indianapolis");
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  console.log(
    `Fetching gameStats for local day 2025-10-04 [${start.toISOString()} .. ${end.toISOString()}) in America/Indiana/Indianapolis`
  );

  // Candidate timestamp fields commonly used
  const TIME_FIELDS = ["submittedAt", "updatedAt", "lastUpdatedAt", "createdAt", "gameDate"];

  let docs: any[] = [];
  let usedField: string | null = null;

  // Try range queries by candidate time fields until one works and returns results
  for (const f of TIME_FIELDS) {
    try {
      const qStats = query(
        collection(db, "gameStats"),
        where(f, ">=", startTs),
        where(f, "<", endTs)
      );
      const snap = await getDocs(qStats);
      if (!snap.empty) {
        usedField = f;
        docs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        break;
      }
    } catch {
      // ignore and try next field (missing indexes/fields)
    }
  }

  // If no docs found via range, fall back to dumping all and filtering client-side if possible
  if (!docs.length) {
    try {
      const allSnap = await getDocs(collection(db, "gameStats"));
      const all = allSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // Try to filter using any timestamp-like field present
      const inRange = all.filter(d => {
        for (const f of TIME_FIELDS) {
          const v = (d as any)[f];
          if (!v) continue;
          let dt: Date | null = null;
          if (v?.toDate) dt = v.toDate();
          else if (typeof v?.seconds === "number") {
            dt = new Date(v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1_000_000));
          } else if (v instanceof Date) dt = v;
          else if (typeof v === "string" || typeof v === "number") {
            const tmp = new Date(v);
            dt = Number.isNaN(tmp.getTime()) ? null : tmp;
          }
          if (dt && dt >= start && dt < end) {
            usedField = f;
            return true;
          }
        }
        return false;
      });

      docs = inRange.length ? inRange : all; // if we can't tell, just show all
    } catch (err) {
      console.error("Failed to fetch gameStats:", err);
      process.exit(1);
    }
  }

  if (usedField) {
    console.log(`(Filtered by '${usedField}' in local-day window)`);
  } else {
    console.log(`(No usable date field found; showing all docs)`);
  }

  // Build rows
  const rows: Array<{ email: string; totalPoints: number; totalPredictions: number }> = [];
  for (const d of docs) {
    let email: string | undefined = d.email;
    if (!email && d.playerId) {
      email = await getUserEmail(db, d.playerId);
    }
    rows.push({
      email: email ?? "(no email)",
      totalPoints: typeof d.totalPoints === "number" ? d.totalPoints : Number(d.totalPoints ?? 0) || 0,
      totalPredictions:
        typeof d.totalPredictions === "number"
          ? d.totalPredictions
          : Number(d.totalPredictions ?? 0) || 0,
    });
  }

  printTable(rows);
})();
