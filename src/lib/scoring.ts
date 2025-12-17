import { db } from '@/db';
import { sites, forecasts, scores } from '@/db/schema';
import { eq } from 'drizzle-orm';

type Rating = 'PG2' | 'PG3' | 'PG4' | 'PG5';

const THRESHOLDS: Record<Rating, { maxWind: number; maxGust: number; maxGustSpread: number; maxCross: number; maxOffAxis: number }> = {
  PG2: { maxWind: 14, maxGust: 18, maxGustSpread: 6, maxCross: 3, maxOffAxis: 15 },
  PG3: { maxWind: 16, maxGust: 22, maxGustSpread: 8, maxCross: 4, maxOffAxis: 20 },
  PG4: { maxWind: 20, maxGust: 28, maxGustSpread: 10, maxCross: 6, maxOffAxis: 25 },
  PG5: { maxWind: 24, maxGust: 32, maxGustSpread: 12, maxCross: 8, maxOffAxis: 30 },
};

function angleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function inSector(dir: number, start: number, end: number): boolean {
  if (start <= end) return dir >= start && dir <= end;
  return dir >= start || dir <= end;
}

function calcScore(wind: number, gust: number, dir: number, site: any, rating: Rating, precip: number): { score: number; label: string; reasons: string[] } {
  const t = THRESHOLDS[rating];
  const reasons: string[] = [];
  let score = 100;

  const ratingKey = 'maxWindSpeed' + rating.charAt(0).toUpperCase() + rating.charAt(1) + rating.slice(2).toLowerCase();
  const siteMax = site[ratingKey] ?? t.maxWind;
  const minWind = site.minWindSpeed ?? 8;
  const angleOff = angleDiff(dir, site.idealWindDirection);
  const gustSpread = gust - wind;
  const cross = wind * Math.sin((angleOff * Math.PI) / 180);

  const isInSector = inSector(dir, site.windSectorStart, site.windSectorEnd);
  
  if (isInSector === false) {
    score -= 40;
    reasons.push('Wind outside flyable sector');
  } else if (angleOff > t.maxOffAxis) {
    score -= Math.min(40, (angleOff - t.maxOffAxis) * 2);
    reasons.push(Math.round(angleOff) + ' deg off ideal');
  }

  if (wind < minWind) {
    score -= Math.min(25, (minWind - wind) * 4);
    reasons.push('Too light (' + Math.round(wind) + 'kt < ' + minWind + 'kt)');
  } else if (wind > siteMax) {
    score -= Math.min(25, (wind - siteMax) * 3);
    reasons.push('Too strong (' + Math.round(wind) + 'kt)');
  }

  if (gustSpread > t.maxGustSpread) {
    score -= Math.min(15, (gustSpread - t.maxGustSpread) * 2);
    reasons.push('Gusty (+' + Math.round(gustSpread) + 'kt spread)');
  }

  if (gust > t.maxGust) {
    score -= Math.min(15, (gust - t.maxGust) * 2);
    reasons.push('Gusts to ' + Math.round(gust) + 'kt');
  }

  if (Math.abs(cross) > t.maxCross) {
    score -= Math.min(10, (Math.abs(cross) - t.maxCross) * 2);
    reasons.push('Cross ' + Math.round(Math.abs(cross)) + 'kt');
  }

  if (precip > 0.5) {
    score -= 10;
    reasons.push('Rain likely');
  }

  score = Math.max(0, Math.min(100, score));
  const label = score >= 80 ? 'perfect' : score >= 55 ? 'flyable' : 'avoid';
  if (label === 'perfect' && reasons.length === 0) reasons.push('Conditions look great');

  return { score, label, reasons };
}

export async function calculateScoresForSite(siteId: string) {
  const siteResult = await db.select().from(sites).where(eq(sites.id, siteId));
  const site = siteResult[0];
  if (site === undefined) throw new Error('Site not found');

  const siteForecasts = await db.select().from(forecasts).where(eq(forecasts.siteId, siteId));
  await db.delete(scores).where(eq(scores.siteId, siteId));

  const rows = siteForecasts.map(f => {
    const wind = f.windSpeed ?? 0;
    const gust = f.windGust ?? wind;
    const dir = f.windDirection ?? 0;
    const precip = f.precipitation ?? 0;

    const pg2 = calcScore(wind, gust, dir, site, 'PG2', precip);
    const pg3 = calcScore(wind, gust, dir, site, 'PG3', precip);
    const pg4 = calcScore(wind, gust, dir, site, 'PG4', precip);
    const pg5 = calcScore(wind, gust, dir, site, 'PG5', precip);

    const aOff = angleDiff(dir, site.idealWindDirection);

    return {
      siteId,
      forecastTime: f.forecastTime,
      scorePg2: pg2.score, scorePg3: pg3.score, scorePg4: pg4.score, scorePg5: pg5.score,
      labelPg2: pg2.label, labelPg3: pg3.label, labelPg4: pg4.label, labelPg5: pg5.label,
      reasonsPg2: pg2.reasons, reasonsPg3: pg3.reasons, reasonsPg4: pg4.reasons, reasonsPg5: pg5.reasons,
      windAngleOff: aOff,
      crossComponent: Math.abs(wind * Math.sin((aOff * Math.PI) / 180)),
      gustSpread: gust - wind,
      confidence: 75,
    };
  });

  if (rows.length > 0) await db.insert(scores).values(rows);
  return rows.length;
}

export async function calculateScoresForAllSites() {
  const allSites = await db.select().from(sites);
  console.log('Calculating scores for ' + allSites.length + ' sites...');
  for (const site of allSites) {
    try {
      const count = await calculateScoresForSite(site.id);
      console.log('  Done: ' + site.name + ': ' + count + ' hours');
    } catch (err) {
      console.error('  Error: ' + site.name + ': ' + err);
    }
  }
  console.log('Scoring complete');
}
