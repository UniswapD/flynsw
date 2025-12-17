import { fetchWeatherForAllSites } from '../src/lib/weather';
import { calculateScoresForAllSites } from '../src/lib/scoring';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('=== FlyNSW Forecast Update ===\n');
  
  await fetchWeatherForAllSites();
  console.log('');
  await calculateScoresForAllSites();
  
  console.log('\n=== Update complete! ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
