const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>";

/** The sender every OpenBookings email goes out from, overridable per environment. */
export const fromAddress = () => process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM;
