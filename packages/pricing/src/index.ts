/**
 * Shared price resolution. The guest-facing search (apps/web) and the host
 * ARI grid (apps/business) both resolve prices through this module, so a rate
 * shown to a host is the same computation a guest is quoted.
 */
export * from "./calculator";
