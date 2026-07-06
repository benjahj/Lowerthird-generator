// Udgiver en ny version til GitHub Releases, så installerede apps auto-opdaterer.
// Brug: 1) sæt nyt "version" i package.json  2) dobbeltklik publish-release.bat
// GitHub-token hentes fra Windows Credential Manager (samme login som git push).
'use strict';

const { spawnSync } = require('child_process');

const cred = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const m = (cred.stdout || '').match(/^password=(.+)$/m);
if (!m) {
  console.error('Kunne ikke hente GitHub-token fra Credential Manager.');
  console.error('Log ind med git først (fx ved at lave et git push).');
  process.exit(1);
}

const version = require('./package.json').version;
console.log('Bygger og udgiver LT Fabrik v' + version + ' ...');

const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: m[1] },
});
process.exit(r.status || 0);
