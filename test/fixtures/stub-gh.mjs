#!/usr/bin/env node
// A stand-in for gh in the relay HQ Open PR tests. `auth status` exits 0, or 1 when
// STUB_GH_AUTH=fail. `pr create` appends its argv as one JSON line to STUB_GH_LOG and
// prints a pull request URL as gh does.

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') process.exit(process.env.STUB_GH_AUTH === 'fail' ? 1 : 0);
if (args[0] === 'pr' && args[1] === 'create') {
  if (process.env.STUB_GH_LOG) appendFileSync(process.env.STUB_GH_LOG, JSON.stringify(args) + '\n');
  process.stdout.write('Creating pull request\n\nhttps://github.com/acme/demo/pull/7\n');
  process.exit(0);
}
process.stderr.write(`stub-gh: unexpected ${args.join(' ')}\n`);
process.exit(2);
