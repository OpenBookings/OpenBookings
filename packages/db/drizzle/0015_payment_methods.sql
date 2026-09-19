-- 0015_payment_methods — the catalogue behind `property_content.payment_methods`.
--
-- Apply BY HAND, same as 0006/0007: this repo has no drizzle journal, so
-- `bun run db:migrate` has no baseline to diff against. Every statement is
-- idempotent, so re-applying against an already-migrated database is a no-op.
--
-- Mirrors `paymentMethods` in packages/db/src/schema.ts; keep the two in sync.
--
-- The listing page used to hold this as a hardcoded map (logo URL + display
-- name per code). Moving it here means adding a method, swapping a logo, or
-- fixing a name is a row edit rather than a deploy.

CREATE TABLE IF NOT EXISTS "payment_methods" (
	"code" varchar(32) PRIMARY KEY,
	"label" varchar(60) NOT NULL,
	-- NULL for methods with no logo (cash), which render as their label.
	"artwork_url" text,
	-- Tooltip shown beside the label. Cash needs one; cards do not.
	"note" varchar(160),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);

-- Seed the codes the property editor already offers (see the PAYMENT_METHODS
-- const in apps/business/.../property/_lib/schema.ts). DO NOTHING rather than
-- an upsert: a re-run must not overwrite a label or logo edited in production.
INSERT INTO "payment_methods" ("code", "label", "artwork_url", "note", "sort_order") VALUES
	('visa',       'Visa',             'https://cdn.openbookings.co/Public/payment-methods/visa.png',       NULL, 10),
	('mastercard', 'Mastercard',       'https://cdn.openbookings.co/Public/payment-methods/mastercard.png', NULL, 20),
	('amex',       'American Express', 'https://cdn.openbookings.co/Public/payment-methods/amex.svg',       NULL, 30),
	('wero',       'Wero',             'https://cdn.openbookings.co/Public/payment-methods/wero-1.svg',     NULL, 40),
	('applepay',   'Apple Pay',        'https://cdn.openbookings.co/Public/payment-methods/applepay.svg',   NULL, 50),
	('cash',       'Cash',             NULL, 'Payment method only available at the hotel', 60)
ON CONFLICT ("code") DO NOTHING;
