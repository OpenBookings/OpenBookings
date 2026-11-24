/**
 * SQL for the guest's label in the thread list. PII minimization (task 15):
 * the list shows initial + surname only (`A. Vries` for Anna de / Vries); the
 * full name and contact load when a single thread is opened. `alias` is a
 * "user" row (or anything with first_name, last_name and name).
 *
 * A guest without a last name falls back to reading the full name as before:
 * a single word is shown as is, otherwise initial + last word.
 */
export function guestLabelSql(alias: string): string {
  const { first, last, name } = { first: `${alias}.first_name`, last: `${alias}.last_name`, name: `${alias}.name` };
  return `CASE
         WHEN btrim(${last}) <> '' AND btrim(${first}) <> '' THEN LEFT(btrim(${first}), 1) || '. ' || btrim(${last})
         WHEN btrim(${last}) <> '' THEN btrim(${last})
         WHEN position(' ' in ${name}) = 0 THEN ${name}
         ELSE LEFT(${name}, 1) || '. ' || split_part(${name}, ' ', -1)
       END`;
}
