import { db } from '../src/db';
import { sites, forecasts, scores } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import SunCalc from 'suncalc';

type Rating = 'PG2' | 'PG3' | 'PG4' | 'PG5';

const THRESHOLDS: Record<Rating, { maxWind: number; maxGust: number; maxGustSpread: number; maxCross: number; maxOffAxis: number }> = {
  PG2: { maxWind: 14, maxGust: 18, maxGustSpread: 6, maxCross: 3, maxOffAxis: 15 },
  PG3: { maxWind: 16, maxGust: 22, maxGustSpread: 8, maxCross: 4, maxOffAxis: 20 },
  PG4: { maxWind: 20, maxGust: 28, maxGustSpread: 10, maxCross: 6, maxOffAxis: 25 },
  PG5: { maxWind: 24, maxGust: 32, maxGustSpread: 12, maxCross: 8, maxOffAxis: 30 },
};

const DAYLIGHT_BUFFER_MINS = 30;

function angleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function inSector(dir: number, start: number, end: number): boolean {
  if (start <= end) return dir >= start && dir <= end;
  return dir >= start || dir <= end;
}

function isDaylightHour(forecastTime: Date, lat: number, lon: number): { ok: boolean; reason?: string } {
  const times = SunCalc.getTimes(forecastTime, lat, lon);
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  
  const earliestLaunch = new Date(sunrise.getTime() + DAYLIGHT_BUFFER_MINS * 60 * 1000);
  const latestLanding = new Date(sunset.getTime() - DAYLIGHT_BUFFER_MINS * 60 * 1000);
  
  if (forecastTime < earliestLaunch) {
    return { ok: false, reason: 'Before sunrise' };
  }
  if (forecastTime >= latestLanding) {
    return { ok: false, reason: 'After sunset' };
  }
  return { ok: true };
}

function calcScore(wind: number, gust: number, dir: number, site: any, rating: Rating, precip: number) {
  const t = THRESHOLDS[rating];
  const reasons: string[] = [];
  let score = 100;

  const siteMax = site[`maxWindSpeed${rating}`] ?? t.maxWind;
  const minWind = site.minWindSpeed ?? 8;
  const angleOff = angleDiff(dir, site.idealWindDirection);
  const gustSpread = gust - wind;
  const cross = wind * Math.sin((angleOff * Math.PI) / 180);

  if (!inSector(dir, site.windSectorStart, site.windSectorEnd)) {
    score -= 40;
    reasons.push('Wind outside flyable sector');
  } else if (angleOff > t.maxOffAxis) {
    score -= Math.min(40, (angleOff - t.maxOffAxis) * 2);
    reasons.push(`${Math.round(angleOff)} deg off ideal`);
  }

  if (wind < minWind) {
    score -= Math.min(25, (minWind - wind) * 4);
    reasons.push(`Too light (${Math.round(wind)}kt)`);
  } else if (wind > siteMax) {
    score -= Math.min(25, (wind - siteMax) * 3);
    reasons.push(`Too strong (${Math.round(wind)}kt)`);
  }

  if (gustSpread > t.maxGustSpread) {
    score -= Math.min(15, (gustSpread - t.maxGustSpread) * 2);
    reasons.push(`Gusty (+${Math.round(gustSpread)}kt)`);
  }

  if (gust > t.maxGust) {
    score -= Math.min(15, (gust - t.maxGust) * 2);
    reasons.push(`Gusts ${Math.round(gust)}kt`);
  }

  if (Math.abs(cross) > t.maxCross) {
    score -= Math.min(10, (Math.abs(cross) - t.maxCross) * 2);
    reasons.push(`Cross ${Math.round(Math.abs(cross))}kt`);
  }

  if (precip > 0.5) {
    score -= 10;
    reasons.push('Rain');
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  const label = score >= 80 ? 'perfect' : score >= 55 ? 'flyable' : 'avoid';
  if (label === 'perfect' && reasons.length === 0) reasons.push('Good conditions');

  return { score, label, reasons };
}

async function main() {
  console.log('=== Running Scoring (with daylight filter) ===\n');
  
  const allSites = await db.select().from(sites);
  console.log(`Processing ${allSites.length} sites...\n`);

  for (const site of allSites) {
    const siteForecasts = await db.select().from(forecasts).where(eq(forecasts.siteId, site.id));
    
    await db.delete(scores).where(eq(scores.siteId, site.id));

    for (const f of siteForecasts) {
      const wind = f.windSpeed ?? 0;
      const gust = f.windGust ?? wind;
      const dir = f.windDirection ?? 0;
      const precip = f.precipitation ?? 0;

      // Check daylight
      const daylight = isDaylightHour(f.forecastTime, site.launchLat, site.launchLon);
      
      let pg2, pg3, pg4, pg5;
      
      if (!daylight.ok) {
        // Outside flyable daylight hours - mark all ratings as avoid
        const nightResult = { score: 0, label: 'avoid', reasons: [daylight.reason!] };
        pg2 = pg3 = pg4 = pg5 = nightResult;
      } else {
        pg2 = calcScore(wind, gust, dir, site, 'PG2', precip);
        pg3 = calcScore(wind, gust, dir, site, 'PG3', precip);
        pg4 = calcScore(wind, gust, dir, site, 'PG4', precip);
        pg5 = calcScore(wind, gust, dir, site, 'PG5', precip);
      }
      
      const aOff = Math.round(angleDiff(dir, site.idealWindDirection));

      await db.insert(scores).values({
        siteId: site.id,
        forecastTime: f.forecastTime,
        scorePg2: pg2.score,
        scorePg3: pg3.score,
        scorePg4: pg4.score,
        scorePg5: pg5.score,
        labelPg2: pg2.label,
        labelPg3: pg3.label,
        labelPg4: pg4.label,
        labelPg5: pg5.label,
        reasonsPg2: pg2.reasons,
        reasonsPg3: pg3.reasons,
        reasonsPg4: pg4.reasons,
        reasonsPg5: pg5.reasons,
        windAngleOff: aOff,
        crossComponent: Math.abs(wind * Math.sin((aOff * Math.PI) / 180)),
        gustSpread: gust - wind,
        confidence: 75,
      });
    }
    console.log(`  ${site.name}: ${siteForecasts.length} hours`);
  }

  const total = await db.select().from(scores);
  console.log(`\nTotal scores: ${total.length}`);
  console.log('Done!');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
