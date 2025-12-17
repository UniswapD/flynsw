import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { scores, forecasts } from '@/db/schema';
import { eq, gte, lte, and, sql } from 'drizzle-orm';

type Rating = 'PG2' | 'PG3' | 'PG4' | 'PG5';
const RATING_ORDER: Rating[] = ['PG2', 'PG3', 'PG4', 'PG5'];

const KEY_MAP = {
  PG2: { score: 'scorePg2', label: 'labelPg2', reasons: 'reasonsPg2' },
  PG3: { score: 'scorePg3', label: 'labelPg3', reasons: 'reasonsPg3' },
  PG4: { score: 'scorePg4', label: 'labelPg4', reasons: 'reasonsPg4' },
  PG5: { score: 'scorePg5', label: 'labelPg5', reasons: 'reasonsPg5' },
} as const;

function canFly(pilot: string, site: string): boolean {
  return RATING_ORDER.indexOf(pilot as Rating) >= RATING_ORDER.indexOf(site as Rating);
}

function degToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

const WARNING_PATTERNS = [
  'Too strong', 'Much too strong', 'Too light for', 'Light for soaring',
  'Gusts too', 'Dangerous gusts', 'Gusty', 'outside safe sector',
  'Crosswind', 'Rain', 'showers', 'off ideal direction'
];

function isWarning(reason: string): boolean {
  return WARNING_PATTERNS.some(pattern => reason.includes(pattern));
}

function hoursToRanges(hours: Date[]): { start: Date; end: Date }[] {
  if (hours.length === 0) return [];
  const sorted = [...hours].sort((a, b) => a.getTime() - b.getTime());
  const ranges: { start: Date; end: Date }[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].getTime() - rangeEnd.getTime() <= 3600000 + 1000) {
      rangeEnd = sorted[i];
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = sorted[i];
      rangeEnd = sorted[i];
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });
  return ranges;
}

function getSunTimes(lat: number, date: Date): { sunriseHour: number; sunsetHour: number } {
  const month = date.getMonth();
  const isSummer = month >= 10 || month <= 2;
  return { sunriseHour: isSummer ? 5 : 7, sunsetHour: isSummer ? 20 : 17 };
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rating = (searchParams.get('rating') || 'PG3') as Rating;
    const timeframe = searchParams.get('timeframe') || 'today';

    const now = new Date();
    const sydneyOffset = 11; // AEDT (summer time)
    const currentUtcHour = now.getUTCHours();
    const currentSydneyHour = (currentUtcHour + sydneyOffset) % 24;
    
    // Calculate Sydney's "today" start (midnight Sydney time in UTC)
    // Sydney midnight = UTC 13:00 previous day (in summer)
    const sydneyMidnightUTC = new Date(now);
    sydneyMidnightUTC.setUTCHours(24 - sydneyOffset, 0, 0, 0); // 13:00 UTC = midnight Sydney
    
    // If current UTC time is before Sydney midnight UTC, we're still in "yesterday" Sydney
    if (now.getUTCHours() < (24 - sydneyOffset)) {
      sydneyMidnightUTC.setUTCDate(sydneyMidnightUTC.getUTCDate() - 1);
    }
    
    let dayStart = new Date(sydneyMidnightUTC);
    let dayEnd = new Date(sydneyMidnightUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
    
    if (timeframe === 'tomorrow') {
      dayStart = new Date(sydneyMidnightUTC.getTime() + 24 * 60 * 60 * 1000);
      dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else if (timeframe === 'now') {
      // For "now", show next 6 hours from current time
      dayStart = new Date(now);
      dayEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    }

    const allSites = await db.execute(sql`
      SELECT id, name, slug, region, min_rating, requires_supervision, requires_radio, requires_induction,
             launch_lat, launch_lon, ideal_wind_direction, holfuy_station_id, webcam_url, windy_url, site_guide_url
      FROM sites
    `);

    const recommendations: any[] = [];
    const keys = KEY_MAP[rating];

    for (const site of allSites.rows as any[]) {
      if (!canFly(rating, site.min_rating)) continue;

      const { sunriseHour, sunsetHour } = getSunTimes(site.launch_lat, dayStart);

      const siteScores = await db.select().from(scores)
        .where(and(eq(scores.siteId, site.id), gte(scores.forecastTime, dayStart), lte(scores.forecastTime, dayEnd)))
        .orderBy(scores.forecastTime);
      
      if (siteScores.length === 0) continue;

      const siteForecasts = await db.select().from(forecasts)
        .where(and(eq(forecasts.siteId, site.id), gte(forecasts.forecastTime, dayStart), lte(forecasts.forecastTime, dayEnd)))
        .orderBy(forecasts.forecastTime);

      const forecastMap = new Map();
      for (const f of siteForecasts) forecastMap.set(f.forecastTime.toISOString(), f);

      // Build comprehensive hourly data
      interface HourData {
        time: string;
        hour: number;
        score: number;
        label: string;
        wind: number;
        gust: number;
        direction: number;
        directionCompass: string;
        temp: number;
        isDaylight: boolean;
        reasons: string[];
      }
      
      const hourlyData: HourData[] = [];
      const perfectHours: Date[] = [];
      const flyableHours: Date[] = [];

      for (const hour of siteScores) {
        const score = (hour as any)[keys.score] ?? 0;
        const label = (hour as any)[keys.label] as string;
        const reasons = (hour as any)[keys.reasons] as string[] || [];
        const forecast = forecastMap.get(hour.forecastTime.toISOString());
        
        const utcHour = new Date(hour.forecastTime).getUTCHours();
        const sydneyHour = (utcHour + sydneyOffset) % 24;
        const isDaylight = sydneyHour >= sunriseHour && sydneyHour < sunsetHour;
        
        const windSpeed = Math.round(forecast?.windSpeed ?? 0);
        const windGust = Math.round(forecast?.windGust ?? 0);
        const windDir = Math.round(forecast?.windDirection ?? 0);
        
        hourlyData.push({
          time: hour.forecastTime.toISOString(),
          hour: sydneyHour,
          score,
          label: isDaylight ? label : 'night',
          wind: windSpeed,
          gust: windGust,
          direction: windDir,
          directionCompass: degToCompass(windDir),
          temp: Math.round(forecast?.temperature ?? 0),
          isDaylight,
          reasons,
        });

        if (isDaylight) {
          if (label === 'perfect') perfectHours.push(hour.forecastTime);
          else if (label === 'flyable') flyableHours.push(hour.forecastTime);
        }
      }

      // Sort by hour for display
      const sortedHourly = [...hourlyData].sort((a, b) => {
        // Handle wrap-around (hours after midnight)
        const aHour = a.hour < 5 ? a.hour + 24 : a.hour;
        const bHour = b.hour < 5 ? b.hour + 24 : b.hour;
        return aHour - bHour;
      });

      // Get daylight hours only
      const daylightHours = sortedHourly.filter(h => h.isDaylight);

      // CURRENT: Closest hour to now (for "today" only)
      let current: HourData | null = null;
      if (timeframe !== 'tomorrow') {
        const nowHour = currentSydneyHour;
        current = daylightHours.reduce((closest, h) => {
          if (!closest) return h;
          return Math.abs(h.hour - nowHour) < Math.abs(closest.hour - nowHour) ? h : closest;
        }, null as HourData | null);
      } else {
        // For tomorrow, show first daylight hour
        current = daylightHours[0] || null;
      }

      // BEST: Highest scoring daylight hour
      const best = daylightHours.reduce((best, h) => {
        if (!best || h.score > best.score) return h;
        return best;
      }, null as HourData | null);

      // PEAK: Strongest wind during daylight (for safety awareness)
      const peak = daylightHours.reduce((peak, h) => {
        if (!peak || h.wind > peak.wind) return h;
        return peak;
      }, null as HourData | null);

      // Calculate trend: compare first half vs second half of daylight
      let trend: 'improving' | 'stable' | 'worsening' = 'stable';
      let trendDetail = '';
      if (daylightHours.length >= 4) {
        const midpoint = Math.floor(daylightHours.length / 2);
        const morning = daylightHours.slice(0, midpoint);
        const afternoon = daylightHours.slice(midpoint);
        const avgMorning = morning.reduce((s, h) => s + h.score, 0) / morning.length;
        const avgAfternoon = afternoon.reduce((s, h) => s + h.score, 0) / afternoon.length;
        
        if (avgAfternoon - avgMorning > 10) {
          trend = 'improving';
          trendDetail = 'Conditions improve through the day';
        } else if (avgMorning - avgAfternoon > 10) {
          trend = 'worsening';
          trendDetail = 'Best conditions early, deteriorating later';
        } else {
          trend = 'stable';
          trendDetail = 'Conditions relatively consistent';
        }
      }

      // Flying window summary
      const allGoodHours = [...perfectHours, ...flyableHours].sort((a, b) => a.getTime() - b.getTime());
      const flyingWindow = allGoodHours.length > 0 ? {
        start: formatHour((new Date(allGoodHours[0]).getUTCHours() + sydneyOffset) % 24),
        end: formatHour((new Date(allGoodHours[allGoodHours.length - 1]).getUTCHours() + sydneyOffset) % 24),
        totalHours: perfectHours.length + flyableHours.length,
        perfectHours: perfectHours.length,
        flyableHours: flyableHours.length,
      } : null;

      // Collect all reasons from the best hour
      const allReasons = best?.reasons || [];

      // Build links
      const links: any = { maps: `https://www.google.com/maps/dir/?api=1&destination=${site.launch_lat},${site.launch_lon}` };
      if (site.holfuy_station_id) links.holfuy = `https://holfuy.com/en/weather/${site.holfuy_station_id}`;
      links.windy = site.windy_url || `https://www.windy.com/?${site.launch_lat},${site.launch_lon},14`;
      if (site.webcam_url) links.webcam = site.webcam_url;
      if (site.site_guide_url) links.siteGuide = site.site_guide_url;

      recommendations.push({
        site: {
          id: site.id, 
          name: site.name, 
          slug: site.slug, 
          region: site.region, 
          minRating: site.min_rating,
          requiresSupervision: site.requires_supervision, 
          requiresRadio: site.requires_radio,
          requiresInduction: site.requires_induction, 
          launchLat: site.launch_lat, 
          launchLon: site.launch_lon,
          idealWindDirection: site.ideal_wind_direction, 
          hasLiveWeather: !!site.holfuy_station_id,
        },
        
        // Current conditions (what's happening now or start of day)
        current: current ? {
          hour: current.hour,
          hourFormatted: formatHour(current.hour),
          wind: current.wind,
          gust: current.gust,
          direction: current.direction,
          directionCompass: current.directionCompass,
          temp: current.temp,
          score: current.score,
          label: current.label,
        } : null,
        
        // Best time to fly
        best: best ? {
          hour: best.hour,
          hourFormatted: formatHour(best.hour),
          wind: best.wind,
          gust: best.gust,
          direction: best.direction,
          directionCompass: best.directionCompass,
          temp: best.temp,
          score: best.score,
          label: best.label,
        } : null,
        
        // Peak wind (safety info)
        peak: peak ? {
          hour: peak.hour,
          hourFormatted: formatHour(peak.hour),
          wind: peak.wind,
          gust: peak.gust,
        } : null,
        
        // Overall assessment (for sorting and display)
        bestScore: best?.score ?? 0,
        bestLabel: best?.label ?? 'avoid',
        
        // Trend
        trend,
        trendDetail,
        
        // Flying window
        flyingWindow,
        
        // Warnings and info
        warnings: allReasons.filter(isWarning),
        info: allReasons.filter(r => !isWarning(r)),
        
        // Timeline for visualization
        hourlyTimeline: sortedHourly.map(h => ({
          time: h.time,
          hour: h.hour,
          score: h.score,
          label: h.label,
          wind: h.wind,
          gust: h.gust,
          direction: h.direction,
          directionCompass: h.directionCompass,
          isDaylight: h.isDaylight,
        })),
        
        // Ranges for text display
        perfectRanges: hoursToRanges(perfectHours).map(r => ({ start: r.start.toISOString(), end: r.end.toISOString() })),
        flyableRanges: hoursToRanges(flyableHours).map(r => ({ start: r.start.toISOString(), end: r.end.toISOString() })),
        
        // Sun times
        sunriseHour,
        sunsetHour,
        
        // Links
        links,
      });
    }

    recommendations.sort((a, b) => b.bestScore - a.bestScore);
    
    return NextResponse.json({ 
      rating, 
      timeframe, 
      generatedAt: new Date().toISOString(), 
      currentHour: currentSydneyHour,
      recommendations 
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed', details: String(error) }, { status: 500 });
  }
}
