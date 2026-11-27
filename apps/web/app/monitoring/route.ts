// The browser SDK sends its envelopes here (`tunnelRoute: "/monitoring"` in
// next.config.ts) so ad-blockers don't drop them on the way to sentry.io.
//
// @sentry/nextjs serves that path from hooks on Node's HTTP server, but
// production runs the standalone server under Bun, where those hooks never
// install and every envelope got a 404. A plain route handler works on either
// runtime; under Node the hooks still answer first and this is not reached.
// It forwards only envelopes for the server SDK's own DSN, without the
// request's cookies or other headers.
export { POST } from "@sentry/nextjs/tunnel";
