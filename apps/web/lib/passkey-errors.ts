type ClientError = { code?: string; message?: string } | null | undefined;

// The browser's own wording for these is not written for a hotel owner
// ("The operation either timed out or was not allowed. See: https://…").
const MESSAGES: Record<string, string> = {
  ERROR_CEREMONY_ABORTED: "The passkey prompt was cancelled or timed out. Nothing was changed.",
  ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY:
    "The passkey prompt was cancelled or timed out. Nothing was changed.",
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: "This device already has a passkey for your account.",
};

/**
 * What to show a host when a passkey action on the security page fails.
 * Messages from our own server are already written for them and pass through.
 */
export function passkeyErrorMessage(error: ClientError, fallback: string): string {
  if (!error) return fallback;
  return (error.code && MESSAGES[error.code]) || error.message || fallback;
}

const CANCELLED = new Set(["ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]);

/**
 * Whether the host dismissed the browser's passkey prompt (or let it time
 * out). In the add-passkey dialog that is not an error: they are still looking
 * at the dialog and can simply try again.
 */
export function isPasskeyPromptCancelled(error: ClientError): boolean {
  return !!error?.code && CANCELLED.has(error.code);
}
