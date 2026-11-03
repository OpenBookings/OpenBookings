import { z } from "zod";

/**
 * A goodwill refund amount from the browser. The dialog builds it with
 * Number(text), so "abc" arrives as NaN. NaN would sail through `<= 0` guards
 * (NaN <= 0 is false) into the refunds table, where it satisfies the CHECK and
 * turns every later SUM(amount) on the booking into NaN.
 */
export const goodwillAmount = z.number().finite().positive();
