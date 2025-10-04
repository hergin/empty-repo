// index.ts
// Watches the "guesses" collection and prints new docs (by submittedAt) as they appear.
// - submittedAt shown in EST/EDT (America/New_York)
// - Filters out: mode, pointsAwarded, groupId, userName
// - Deep-transforms any Firestore timestamp shape
// - Looks up the user's email from the "users" collection using playerId

import {
  collection,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from "firebase/firestore";

import { loadDbFromConfig } from "./loadDbFromConfig";

const db = loadDbFromConfig(); // ← uses firebaseConfig.ts on disk

// ---------- Time & Transform Helpers ----------
type MaybeTimestamp =
  | { toDate: () => Date } // Firestore Timestamp-like
  | { seconds: number; nanoseconds: number } // Plain object form
  | Date
  | string
  | number
  | null
  | undefined;

function isFSTimestampMethod(v: any): v is { toDate: () => Date } {
  return v && typeof v === "object" && typeof v.toDate === "function";
}

function isFSTimestampPojo(v: any): v is { seconds: number; nanoseconds: number } {
  return (
    v &&
    typeof v === "object" &&
    typeof v.seconds === "number" &&
    typeof v.nanoseconds === "number"
  );
}

function toDateStrict(v: MaybeTimestamp): Date | null {
  if (!v && v !== 0) return null;
  if (isFSTimestampMethod(v)) return v.toDate();
  if (isFSTimestampPojo(v)) {
    const ms = v.seconds * 1000 + Math.floor(v.nanoseconds / 1_000_000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toESTString(date: Date | null): string {
  if (!date) return "(no submittedAt)";
  return date.toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
}

function deepTransformTimestamps(value: any): any {
  const dt = toDateStrict(value);
  if (dt) return toESTString(dt);

  if (Array.isArray(value)) return value.map((v) => deepTransformTimestamps(v));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepTransformTimestamps(v);
    }
    return out;
  }
  return value;
}

// --- Cache for playerId → email ---
const userEmailCache = new Map<string, string>();

// Fetch user email from Firestore (with caching)
async function getUserEmail(db: any, playerId: string | undefined | null): Promise<string> {
  if (!playerId) return "(no playerId)";
  if (userEmailCache.has(playerId)) return userEmailCache.get(playerId)!;

  try {
    const ref = doc(collection(db, "users"), playerId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      const email = data.email || "(no email)";
      userEmailCache.set(playerId, email);
      return email;
    }
    userEmailCache.set(playerId, "(not found)");
    return "(not found)";
  } catch (err) {
    console.error(`Error fetching user email for ${playerId}:`, err);
    return "(error)";
  }
}

// Remove unwanted fields before printing
function stripFields<T extends Record<string, any>>(doc: T) {
  const { mode, pointsAwarded, groupId, userName, ...rest } = doc;
  return rest;
}

// ---------- Pretty print ----------
async function printDoc(db: any, rawDoc: any) {
  const submittedAtStr = toESTString(toDateStrict(rawDoc.submittedAt));
  const body = stripFields(rawDoc);
  const transformed = deepTransformTimestamps({ id: rawDoc.id, ...body });
  transformed.submittedAt = submittedAtStr;

  const email = await getUserEmail(db, rawDoc.playerId);
  transformed.email = email;

  console.log(JSON.stringify(transformed, null, 2));
}

// ---------- Main ----------
(async () => {

  let lastSeen: Date | null = null;
  const N = 10;

  // Initial load: show newest N
  {
    const q = query(collection(db, "guesses"), orderBy("submittedAt", "desc"), limit(N));
    const snap = await getDocs(q);
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

    if (docs.length) {
      console.log(`\nInitial latest ${docs.length} guesses:\n`);
      for (const doc of docs) {
        await printDoc(db, doc);
      }
      lastSeen = toDateStrict(docs[0]?.submittedAt) ?? lastSeen;
    } else {
      console.log("No existing documents found in 'guesses'. Waiting for new ones…");
    }
  }

  // Live listener: only print docs strictly newer than lastSeen
  const liveQuery = query(collection(db, "guesses"), orderBy("submittedAt", "desc"), limit(N));

  onSnapshot(liveQuery, async (snap) => {
    const nowDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
    if (!nowDocs.length) return;

    const newestTime = toDateStrict(nowDocs[0]?.submittedAt);
    if (!lastSeen) {
      lastSeen = newestTime ?? lastSeen;
      return;
    }

    const fresh = nowDocs
      .filter((d) => {
        const dt = toDateStrict(d.submittedAt);
        return dt && lastSeen && dt.getTime() > lastSeen.getTime();
      })
      .sort((a, b) => {
        const da = toDateStrict(a.submittedAt)?.getTime() ?? 0;
        const dbt = toDateStrict(b.submittedAt)?.getTime() ?? 0;
        return da - dbt; // oldest -> newest among fresh
      });

    if (fresh.length) {
      console.log(`\nNew guesses (${fresh.length}) detected:\n`);
      for (const doc of fresh) {
        await printDoc(db, doc);
      }
      const latest = toDateStrict(fresh[fresh.length - 1]?.submittedAt);
      if (latest && (!lastSeen || latest.getTime() > lastSeen.getTime())) {
        lastSeen = latest;
      }
    }
  });

  console.log("Watching 'guesses'… (Ctrl+C to exit)");
})();
