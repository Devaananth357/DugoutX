import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let initialization: Promise<ReturnType<typeof getFirestore>> | undefined;

export function getServerFirestore() {
  initialization ??= (async () => {
    if (!getApps().length) {
      const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      const credentialPath = path.join(process.cwd(), "firebase-service-account.json");
      const serviceAccount = JSON.parse(
        credentialJson ?? (await readFile(credentialPath, "utf8")),
      );
      initializeApp({ credential: cert(serviceAccount) });
    }
    return getFirestore(getApp());
  })();
  return initialization;
}
