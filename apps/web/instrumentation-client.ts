import * as Sentry from "@sentry/nextjs";
import { startNavigation } from "./lib/navigation-progress";
import "./sentry.client.config";

export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  Sentry.captureRouterTransitionStart(url, navigationType);
  startNavigation(url);
}
