// Plain JS (no deps) so it runs even on the old Node we're guarding against.
// Wired as npm pre-hooks (predev/prebuild/prereport) to fail early
// with a clear message instead of Vite's cryptic crypto.getRandomValues crash.
const MIN = 20;
const major = Number(process.versions.node.split('.')[0]);

if (major < MIN) {
  console.error(`\n✗ Node ${process.versions.node} détecté - PRecap requiert Node >= ${MIN} (Vite 7).`);
  console.error(`  Lance « nvm use » (lit .nvmrc → Node 24), puis relance la commande.\n`);
  process.exit(1);
}
