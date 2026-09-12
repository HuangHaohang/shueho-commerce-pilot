import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLoadConfig, validateReadFixtures, runReadLoad } from './read-load.mjs';

if (!process.env.LOADTEST_USERS_FILE || !process.env.LOADTEST_OUTPUT_DIR) {
  throw new Error('Set private fixture and metrics paths; keep cookies out of git.');
}
const config = readLoadConfig(process.env, process.argv[3]);
const users = JSON.parse(readFileSync(process.env.LOADTEST_USERS_FILE, 'utf8'));
validateReadFixtures(users, config.counts);
const label = process.argv[2] ?? 'candidate';
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(label)) throw new Error('Use a simple label without path separators.');
const output = [];
for (const count of config.counts) {
  const result = await runReadLoad(users, count, config);
  result.summary.label = label;
  output.push(result);
  writeFileSync(join(process.env.LOADTEST_OUTPUT_DIR, `http-${label}.json`), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(result.summary));
}
if (output.some(({ summary }) => !summary.passed)) process.exitCode = 1;
