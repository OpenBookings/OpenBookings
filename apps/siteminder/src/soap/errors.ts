/** One `<Error Type=".." Code="..">` of an OTA response. Wording is case-sensitive: SiteMinder's auto-disable matches on it. */
export type OtaError = { type: number; code?: number; message: string };

/** Mandatory errors, with the exact Type/Code/text from SiteMinder's Error Handling guide. */
export const invalidCredentials = (): OtaError => ({ type: 4, code: 448, message: "Invalid Username and/or Password" });
export const hotelNotFound = (hotelCode: string): OtaError => ({
  type: 6,
  code: 392,
  message: `Hotel not found for HotelCode=${hotelCode}`,
});
export const roomTypeNotFound = (): OtaError => ({ type: 12, code: 402, message: "Room type code not found for this hotel" });
export const rateCodeNotFound = (): OtaError => ({ type: 12, code: 249, message: "Rate code not found for this hotel" });
export const invalidIncludedOccupancy = (expecting?: number): OtaError => ({
  type: 12,
  code: 137,
  message: expecting === undefined ? "Invalid included occupancy" : `Invalid included occupancy: expecting ${expecting}`,
});
export const invalidNumberOfAdults = (expecting?: number): OtaError => ({
  type: 12,
  code: 397,
  message: expecting === undefined ? "Invalid number of adults" : `Invalid number of adults: expecting ${expecting}`,
});

/** Structural problems (Type 10, no Code, as in SiteMinder's "Node CreateDateTime must exist" sample). */
export const invalidRequest = (message: string): OtaError => ({ type: 10, message });

/**
 * The docs' error table has no entry for "our backend is down". Type 12 (OTA "Processing exception") is the
 * type SiteMinder's own sample uses for processing-level failures; no Code, as with the structural errors.
 */
export const temporarilyUnavailable = (): OtaError => ({
  type: 12,
  message: "Room and rate configuration is temporarily unavailable, please try again shortly",
});
