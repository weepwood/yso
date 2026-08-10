import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const version = String(pkg.version ?? '').trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid package version: ${JSON.stringify(version)}`);
  process.exit(1);
}

const heading = `## v${version}`;
if (!changelog.split(/\r?\n/).some((line) => line.startsWith(heading))) {
  console.error(`CHANGELOG.md is missing release heading: ${heading}`);
  process.exit(1);
}

console.log(`[version] package.json=${version} changelog=${heading}`);
