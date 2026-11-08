-- 0037_billing_report_views — quarterly tax and compliance reports over the invoices.
--
-- Read-only views the billing job's report step turns into CSV files:
--
--   v_vat_return_quarter       Dutch VAT return: domestic turnover and VAT,
--                              and reverse-charge turnover (EU hosts)
--   v_icp_listing_quarter      the intra-community listing: reverse-charge
--                              turnover per host VAT id
--   v_dac7_fees_quarter        DAC7: commission fees per host
--   v_returned_payments_quarter payments returned to the guest in full, which
--                              were never invoiced
--
-- The invoice views count issued and sent documents only, by the quarter of
-- the issue date; credit notes carry negative totals, so plain sums net them.
-- Returned payments are placed by the Amsterdam date of the fee.
--
-- Additive and re-runnable.

CREATE OR REPLACE VIEW v_vat_return_quarter AS
SELECT to_char(issued_on, 'YYYY') || 'Q' || extract(quarter FROM issued_on)::int AS quarter,
       COALESCE(SUM(net_total) FILTER (WHERE vat_treatment = 'NL_DOMESTIC'), 0)::bigint AS nl_net,
       COALESCE(SUM(vat_total) FILTER (WHERE vat_treatment = 'NL_DOMESTIC'), 0)::bigint AS nl_vat,
       COALESCE(SUM(net_total) FILTER (WHERE vat_treatment = 'EU_REVERSE_CHARGE'), 0)::bigint AS rc_net
  FROM invoices
 WHERE status IN ('issued', 'sent')
 GROUP BY 1;

CREATE OR REPLACE VIEW v_icp_listing_quarter AS
SELECT to_char(issued_on, 'YYYY') || 'Q' || extract(quarter FROM issued_on)::int AS quarter,
       buyer->>'vatId' AS vat_id,
       upper(substring(buyer->>'vatId' FROM 1 FOR 2)) AS country_code,
       SUM(net_total)::bigint AS rc_net
  FROM invoices
 WHERE status IN ('issued', 'sent') AND vat_treatment = 'EU_REVERSE_CHARGE'
 GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW v_dac7_fees_quarter AS
SELECT to_char(issued_on, 'YYYY') || 'Q' || extract(quarter FROM issued_on)::int AS quarter,
       billing_entity_id,
       max(buyer->>'legalName') AS legal_name,
       SUM(gross_total)::bigint AS fee_gross
  FROM invoices
 WHERE status IN ('issued', 'sent')
 GROUP BY 1, 2;

-- One row per returned fee. refunded_gross is what its refund entries took
-- back, as a positive amount, so a fully returned payment has
-- fee_gross = refunded_gross.
CREATE OR REPLACE VIEW v_returned_payments_quarter AS
SELECT to_char(f.occurred_at AT TIME ZONE 'Europe/Amsterdam', 'YYYY')
         || 'Q' || extract(quarter FROM f.occurred_at AT TIME ZONE 'Europe/Amsterdam')::int AS quarter,
       f.billing_entity_id,
       f.stripe_account_id,
       f.stripe_payment_ref,
       f.stripe_application_fee_id,
       f.gross_amount AS fee_gross,
       COALESCE((SELECT -SUM(r.gross_amount) FROM commission_entries r WHERE r.refunds_entry_id = f.id), 0)::bigint AS refunded_gross,
       (f.occurred_at AT TIME ZONE 'Europe/Amsterdam')::date AS returned_on
  FROM commission_entries f
 WHERE f.disposition = 'returned' AND f.kind = 'fee';
