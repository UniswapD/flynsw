import { db } from '@/db';
import { sites, forecasts } from '@/db/schema';
import { eq } from 'drizzle-orm';

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    temperature_2m: number[];
    precipitation: number[];
    precipitation_probability: number[];
    cloud_cover: number[];
  };
}

// Convert m/s to knots
function msToKnots(ms: number): number {
  return ms * 1.94384;
}

export async function fetchWeatherForSite(siteId: string, lat: number, lon: number) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('hourly', [
    'wind_speed_10m',
    'wind_direction_10m', 
    'wind_gusts_10m',
    'temperature_2m',
    'precipitation',
    'precipitation_probability',
    'cloud_cover'
  ].join(','));
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('timezone', 'Australia/Sydney');
  url.searchParams.set('forecast_days', '3');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status}`);
  }

  const data: OpenMeteoResponse = await response.json();
  
  // Delete old forecasts for this site
  await db.delete(forecasts).where(eq(forecasts.siteId, siteId));

  // Insert new forecasts
  const forecastRows = data.hourly.time.map((time, i) => ({
    siteId,
    forecastTime: new Date(time),
    provider: 'open-meteo',
    windSpeed: msToKnots(data.hourly.wind_speed_10m[i]),
    windDirection: data.hourly.wind_direction_10m[i],
    windGust: msToKnots(data.hourly.wind_gusts_10m[i]),
    temperature: data.hourly.temperature_2m[i],
    precipitation: data.hourly.precipitation[i],
    precipitationProbability: data.hourly.precipitation_probability[i],
    cloudCover: data.hourly.cloud_cover[i],
    rawData: {
      wind_speed_ms: data.hourly.wind_speed_10m[i],
      wind_gust_ms: data.hourly.wind_gusts_10m[i],
    },
  }));

  await db.insert(forecasts).values(forecastRows);
  
  return forecastRows.length;
}

export async function fetchWeatherForAllSites() {
  const allSites = await db.select().from(sites);
  
  console.log(`Fetching weather for ${allSites.length} sites...`);
  
  for (const site of allSites) {
    try {
      const count = await fetchWeatherForSite(site.id, site.launchLat, site.launchLon);
      console.log(`  ✓ ${site.name}: ${count} hours`);
      // Small delay to be nice to the API
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`  ✗ ${site.name}: ${err}`);
    }
  }
  
  console.log('Weather fetch complete!');
}
