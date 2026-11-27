/**
 * A setting step-up needs (ADMIN_TOTP_KEY, ADMIN_RP_ID) is missing or wrong.
 * Only an operator can fix it, so the console says which one instead of
 * failing with an error the browser never sees.
 */
export class StepUpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepUpConfigError";
  }
}
