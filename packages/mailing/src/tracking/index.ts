export { clickRedirectConfig, trackingConfig, type TrackingConfig } from "./config";
export { isConsented, trackMail, type TrackDeps } from "./track";
export { captureOutcome, type OutcomeEvent } from "./outcome";
export { openToken, sealToken, type EmailKind, type TrackingToken } from "./token";
export { instrumentHtml, linkName } from "./instrument";
export { PIXEL_GIF, clientProxy, clickDestination, handleClick, handleOpen } from "./handle";
