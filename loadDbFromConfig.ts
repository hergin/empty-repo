// Reads ./firebaseConfig.ts, extracts `const firebaseConfig = {...}`, and returns a Firestore DB.
// This avoids running RN-only code (initializeAuth / AsyncStorage) in Node.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

export function loadDbFromConfig(configPath = "./firebaseConfig.ts") {
  const full = path.resolve(configPath);
  const code = fs.readFileSync(full, "utf8");

  // Grab the object literal assigned to const firebaseConfig = { ... };
  const match = code.match(/const\s+firebaseConfig\s*=\s*({[\s\S]*?});/);
  if (!match) {
    throw new Error(
      `Could not find "const firebaseConfig = {...}" in ${configPath}.`
    );
  }

  const objLiteral = match[1];

  // Evaluate the object literal safely-ish in a sandbox
  // (object contains only string keys/values in your example).
  const sandbox: any = {};
  const script = new vm.Script("(" + objLiteral + ")");
  const firebaseConfig = script.runInNewContext(sandbox);

  if (!firebaseConfig?.projectId) {
    throw new Error("Parsed firebaseConfig seems invalid (missing projectId).");
  }

  const app = initializeApp(firebaseConfig);
  return getFirestore(app);
}
