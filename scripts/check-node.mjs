const MIN = 20;
const major = Number(process.versions.node.split('.')[0]);

if (major < MIN) {
  console.error(`\n✗ Node ${process.versions.node} détecté - PRecap requiert Node >= ${MIN} (Vite 7).`);
  console.error(`  Lance « nvm use » (lit .nvmrc → Node 24), puis relance la commande.\n`);
  process.exit(1);
}
