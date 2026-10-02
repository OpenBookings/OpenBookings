/** The code the auth gate returns when an action needs a fresh verification. */
export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

/** Whether a Better Auth client result was refused for want of step-up. */
export function isStepUpRequired(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const error = (result as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === STEP_UP_REQUIRED;
}
