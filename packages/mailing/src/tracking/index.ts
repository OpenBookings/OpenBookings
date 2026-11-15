export { trackingConfig, type TrackingConfig } from "./config";
export { ANONYMOUS_KINDS, isConsented, trackMail, type TrackDeps } from "./track";
export { captureOutcome, type OutcomeEvent } from "./outcome";
export { openToken, sealToken, type EmailKind, type TrackingToken } from "./token";
export { instrumentHtml, linkName } from "./instrument";
