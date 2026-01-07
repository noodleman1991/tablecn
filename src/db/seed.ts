// Seed file - currently no seed functions defined
// Add seed functions here if needed for development

async function runSeed() {
  console.log('⏳ No seed functions configured');
  process.exit(0);
}

runSeed().catch((err) => {
  console.error('❌ Seed failed');
  console.error(err);
  process.exit(1);
});
