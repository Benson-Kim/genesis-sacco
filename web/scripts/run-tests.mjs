/**
 * Test entrypoint. CI invokes `npm test -- --ci`; the extra flag is a
 * pipeline convention, not a node:test option, so this wrapper drops
 * unknown args and delegates to the built-in test runner.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(process.execPath, ['--test', join(webRoot, 'tests')], {
  stdio: 'inherit',
  cwd: webRoot,
});
process.exit(result.status ?? 1);
