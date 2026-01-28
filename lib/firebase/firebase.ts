/**
 * Client-only Firebase Auth. Re-exports from firebase.client.ts so all
 * initialization and config live in one place (authDomain is always
 * openb-481417.firebaseapp.com). Do not use this in server code.
 */
export { auth } from "./firebase.client";
