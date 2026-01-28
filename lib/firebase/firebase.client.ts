"use client";

import { initializeApp, getApps } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Firebase client config.
 * authDomain is ALWAYS the Firebase auth handler domain so OAuth redirect_uri
 * is https://openb-481417.firebaseapp.com/__/auth/handler (never openbookings.co).
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: "openb-481417.firebaseapp.com" as const,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: ReturnType<typeof initializeApp> | undefined;
let authInstance: Auth | undefined;

function initializeFirebase(): Auth {
  if (typeof window === "undefined") {
    throw new Error(
      "Firebase Auth is only available in the browser. Do not use auth in server components or during SSR."
    );
  }

  if (authInstance) {
    return authInstance;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
  } else {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      const missing: string[] = [];
      if (!firebaseConfig.apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
      if (!firebaseConfig.projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
      throw new Error(
        `Firebase configuration is missing. Set: ${missing.join(", ")}`
      );
    }
    app = initializeApp(firebaseConfig);
  }

  authInstance = getAuth(app);
  return authInstance;
}

export const auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const authRef = initializeFirebase();
    const value = (authRef as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(authRef);
    }
    return value;
  },
});
