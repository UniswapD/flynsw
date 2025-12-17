import { fetchWeatherForAllSites } from '../src/lib/weather';
import { db } from '../src/db';
import { sites, forecasts, scores } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import SunCalc from 'suncalc';

type Rating = 'PG2' | 'PG3' | 'PG4' | 'PG5';

const THRESHOLDS: Record<Rating, { maxWind: number; maxGust: number; maxGustSpread: number; maxCross: number; maxOffAxis: number; warningOffAxis: number; minSoarable: number; minAcceptable: number }> = {
  PG2: { maxWind: 12, maxGust: 16, maxGustSpread: 5, maxCross: 3, maxOffAxis: 15, warningOffAxis: 25, minSoarable: 0, minAcceptable: 0 },
  PG3: { maxWind: 16, maxGust: 20, maxGustSpread: 7, maxCross: 4, maxOffAxis: 20, warningOffAxis: 30, minSoarable: 0, minAcceptable: 0 },
  PG4: { maxWind: 20, maxGust: 26, maxGustSpread: 10, maxCross: 6, maxOffAxis: 25, warningOffAxis: 35, minSoarable: 8, minAcceptable: 5 },
  PG5: { maxWind: 25, maxGust: 32, maxGustSpread: 12, maxCross: 8, maxOffAxis: 30, warningOffAxis: 40, minSoarable: 8, minAcceptable: 5 },
};

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
  const earliestLaunch = new Date(times.sunrise.getTime() + 30 * 60 * 1000);
  const latestLanding = new Date(times.sunset.getTime() - 30 * 60 * 1000);
  if (forecastTime < earliestLaunch) return { ok: false, reason: 'Before sunrise +30min' };
  if (forecastTime >= latestLanding) return { ok: false, reason: 'After sunset -30min' };
  return { ok: true };
}

function calcScore(wind: number, gust: number, dir: number, site: any, rating: Rating, precip: number) {
  const t = THRESHOLDS[rating];
  const warnings: string[] = [];
  const info: string[] = [];
  let score = 100;
  let hardFail = false;

  const siteMax = site[`maxWindSpeed${rating}`] ?? t.maxWind;
  const siteMinSoarable = site.minWindSpeed ?? 8;
  const angleOff = angleDiff(dir, site.idealWindDirection);
  const gustSpread = gust - wind;
  const cross = Math.abs(wind * Math.sin((angleOff * Math.PI) / 180));

  // ========== HARD FAILS (label = avoid) ==========

  if (precip > 0.5) {
    hardFail = true;
    score = Math.min(score, 25);
    warnings.push('Rain - not flyable');
  }

  if (!inSector(dir, site.windSectorStart, site.windSectorEnd)) {
    hardFail = true;
    score = Math.min(score, 30);
    warnings.push('Wind outside safe sector');
  }

  if ((rating === 'PG4' || rating === 'PG5') && wind < t.minAcceptable) {
    hardFail = true;
    score = Math.min(score, 35);
    warnings.push(`Too light for ${rating} (${Math.round(wind)}kt)`);
  }

  if (wind > siteMax + 6) {
    hardFail = true;
    score = Math.min(score, 30);
    warnings.push(`Much too strong (${Math.round(wind)}kt)`);
  }

  if (gust > t.maxGust + 8) {
    hardFail = true;
    score = Math.min(score, 30);
    warnings.push(`Dangerous gusts (${Math.round(gust)}kt)`);
  }

  // ========== WARNINGS (safety concerns - cap at 75) ==========

  if (angleOff > t.warningOffAxis && inSector(dir, site.windSectorStart, site.windSectorEnd)) {
    score -= Math.min(35, (angleOff - t.warningOffAxis) * 2);
    warnings.push(`${Math.round(angleOff)}° off ideal direction`);
  }

  if (wind > siteMax && wind <= siteMax + 6) {
    score -= Math.min(30, (wind - siteMax) * 5);
    warnings.push(`Too strong (${Math.round(wind)}kt, max ${siteMax}kt)`);
  }

  if (gust > t.maxGust && gust <= t.maxGust + 8) {
    score -= Math.min(25, (gust - t.maxGust) * 3);
    warnings.push(`Gusts too high (${Math.round(gust)}kt)`);
  }

  if (gustSpread > t.maxGustSpread + 2) {
    score -= Math.min(20, (gustSpread - t.maxGustSpread) * 3);
    warnings.push(`Gusty (+${Math.round(gustSpread)}kt spread)`);
  }

  if (cross > t.maxCross + 2) {
    score -= Math.min(15, (cross - t.maxCross) * 2);
    warnings.push(`Crosswind ${Math.round(cross)}kt`);
  }

  if (precip > 0.2 && precip <= 0.5) {
    score -= 20;
    warnings.push('Possible showers');
  }

  if ((rating === 'PG4' || rating === 'PG5') && wind >= t.minAcceptable && wind < t.minSoarable) {
    score -= Math.min(20, (t.minSoarable - wind) * 4);
    warnings.push(`Light for soaring (${Math.round(wind)}kt)`);
  }

  // ========== INFO NOTES ==========

  if (angleOff > 10 && angleOff <= t.warningOffAxis) {
    const deduction = Math.round((angleOff - 10) * 0.5);
    score -= deduction;
    info.push(`${Math.round(angleOff)}° off ideal`);
  }

  if (gustSpread > 3 && gustSpread <= t.maxGustSpread + 2) {
    const deduction = Math.round((gustSpread - 3) * 1);
    score -= deduction;
    if (!warnings.some(w => w.includes('Gusty'))) {
      info.push(`Gust spread +${Math.round(gustSpread)}kt`);
    }
  }

  if (rating === 'PG2' || rating === 'PG3') {
    if (wind < 4) {
      score -= 10 + Math.round((4 - wind) * 2);
      info.push('Very light - likely a sled ride');
    } else if (wind < siteMinSoarable) {
      score -= 5 + Math.round((siteMinSoarable - wind) * 1);
      info.push('Light for extended soaring');
    }
  }

  if (wind >= siteMinSoarable && wind < 10) {
    score -= Math.round((10 - wind) * 0.5);
  }

  // ========== FINAL SCORING ==========

  if (warnings.length > 0 && !hardFail) {
    score = Math.min(score, 75);
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  
  // NEW: 4-tier labeling with 'marginal'
  let label: string;
  if (hardFail || score < 40) {
    label = 'avoid';
  } else if (score >= 80 && warnings.length === 0) {
    label = 'perfect';
  } else if (score >= 55 && warnings.length <= 1) {
    label = 'flyable';
  } else if (score >= 40) {
    // Score 40-54, OR score 55+ but with 2+ warnings = marginal
    label = 'marginal';
  } else {
    label = 'avoid';
  }

  // Positive notes for good conditions
  if (label === 'perfect' && warnings.length === 0) {
    if (wind >= 10 && wind <= 15 && angleOff <= 5 && gustSpread <= 3) {
      if (info.length === 0) info.push('Ideal soaring conditions');
    } else if (wind >= 8 && angleOff <= 10 && info.length === 0) {
      info.push('Good soaring conditions');
    }
  }

  return { score, label, reasons: [...warnings, ...info], warnings, info };
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting update...`);
  
  console.log('Fetching weather...');
  await fetchWeatherForAllSites();
  
  console.log('Calculating scores...');
  const allSites = await db.select().from(sites);
  
  for (const site of allSites) {
    const siteForecasts = await db.select().from(forecasts).where(eq(forecasts.siteId, site.id));
    await db.delete(scores).where(eq(scores.siteId, site.id));

    for (const f of siteForecasts) {
      const wind = f.windSpeed ?? 0;
      const gust = f.windGust ?? wind;
      const dir = f.windDirection ?? 0;
      const precip = f.precipitation ?? 0;
      const daylight = isDaylightHour(f.forecastTime, site.launchLat, site.launchLon);
      
      let pg2, pg3, pg4, pg5;
      if (!daylight.ok) {
        const nightResult = { score: 0, label: 'avoid', reasons: [daylight.reason!], warnings: [daylight.reason!], info: [] };
        pg2 = pg3 = pg4 = pg5 = nightResult;
      } else {
        pg2 = calcScore(wind, gust, dir, site, 'PG2', precip);
        pg3 = calcScore(wind, gust, dir, site, 'PG3', precip);
        pg4 = calcScore(wind, gust, dir, site, 'PG4', precip);
        pg5 = calcScore(wind, gust, dir, site, 'PG5', precip);
      }
      
      const aOff = Math.round(angleDiff(dir, site.idealWindDirection));

      await db.insert(scores).values({
        siteId: site.id, forecastTime: f.forecastTime,
        scorePg2: pg2.score, scorePg3: pg3.score, scorePg4: pg4.score, scorePg5: pg5.score,
        labelPg2: pg2.label, labelPg3: pg3.label, labelPg4: pg4.label, labelPg5: pg5.label,
        reasonsPg2: pg2.reasons, reasonsPg3: pg3.reasons, reasonsPg4: pg4.reasons, reasonsPg5: pg5.reasons,
        windAngleOff: aOff, crossComponent: Math.abs(wind * Math.sin((aOff * Math.PI) / 180)),
        gustSpread: gust - wind, confidence: 75,
      });
    }
  }
  
  console.log(`[${new Date().toISOString()}] Update complete!`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
