import { afterAll, mock } from "bun:test";

/**
 * Test-only. bun's `mock.module` is process-wide, so a file that mocks a
 * shared module (auth, db, next/server) breaks every test file that runs
 * after it. This mocks the given modules and puts the real ones back in
 * `afterAll`. Relative specifiers resolve against `dir` (pass `import.meta.dir`).
 * `keep` lists modules that stay mocked: the real auth module throws on import
 * without its env, so there is nothing to snapshot (other tests mock it for the
 * same reason).
 */
export async function mockModules(dir: string, factories: Record<string, () => Record<string, unknown>>, keep: string[] = []) {
  const real: [string, Record<string, unknown> | null][] = [];
  for (const [spec, factory] of Object.entries(factories)) {
    const target = spec.startsWith(".") ? Bun.resolveSync(spec, dir) : spec;
    const original = keep.includes(spec) ? null : await import(target).then(
      (m) => ({ ...m }) as Record<string, unknown>,
      () => null,
    );
    real.push([target, original]);
    mock.module(target, factory);
  }
  afterAll(() => {
    for (const [target, original] of real) if (original) mock.module(target, () => original);
  });
}
