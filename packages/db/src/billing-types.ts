/**
 * How VAT applies to a host's commission invoice: Dutch 21% VAT for NL hosts,
 * or the EU reverse charge (0% on the invoice) for hosts in other member states.
 */
export type VatTreatment = "NL_DOMESTIC" | "EU_REVERSE_CHARGE";
