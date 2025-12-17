const fs = require('fs');

// API recommendations route
const apiRoute = `import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { sites, scores } from '@/db/schema';
import { eq, gte, lte, and } from 'drizzle-orm';

type Rating = 'PG2' | 'PG3' | 'PG4' | 'PG5';
const RATING_ORDER = ['PG2', 'PG3', 'PG4', 'PG5'];

function canFly(pilot, site) {
  return RATING_ORDER.indexOf(pilot) >= RATING_ORDER.indexOf(site);
}

export async function GET(request) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rating = searchParams.get('rating') || 'PG3';
    const timeframe = searchParams.get('timeframe') || 'today';

    const now = new Date();
    let startTime = now;
    let endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    if (timeframe === 'now') {
      endTime = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    } else if (timeframe === 'tomorrow') {
      startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      endTime = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    }

    const allSites = await db.select().from(sites);
    const recommendations = [];

    for (const site of allSites) {
      if (!canFly(rating, site.minRating)) continue;

      const siteScores = await db.select().from(scores)
        .where(and(eq(scores.siteId, site.id), gte(scores.forecastTime, startTime), lte(scores.forecastTime, endTime)))
        .orderBy(scores.forecastTime);

      if (siteScores.length === 0) continue;

      const scoreKey = 'score' + rating;
      const labelKey = 'label' + rating;
      const reasonsKey = 'reasons' + rating;

      let bestScore = 0, bestHour = siteScores[0];
      let perfectHours = [], flyableHours = [];

      for (const hour of siteScores) {
        const score = hour[scoreKey] || 0;
        const label = hour[labelKey];
        if (score > bestScore) { bestScore = score; bestHour = hour; }
        if (label === 'perfect') perfectHours.push(hour.forecastTime);
        else if (label === 'flyable') flyableHours.push(hour.forecastTime);
      }

      const goodHours = [...perfectHours, ...flyableHours].sort((a, b) => a.getTime() - b.getTime());

      recommendations.push({
        site: { id: site.id, name: site.name, slug: site.slug, region: site.region, minRating: site.minRating,
          requiresSupervision: site.requiresSupervision, requiresRadio: site.requiresRadio,
          requiresInduction: site.requiresInduction, launchLat: site.launchLat, launchLon: site.launchLon },
        bestScore: Math.round(bestScore),
        bestLabel: bestHour[labelKey],
        bestReasons: bestHour[reasonsKey] || [],
        bestTime: bestHour.forecastTime,
        windowStart: goodHours[0] || null,
        windowEnd: goodHours[goodHours.length - 1] || null,
        perfectHoursCount: perfectHours.length,
        flyableHoursCount: flyableHours.length,
        confidence: bestHour.confidence,
      });
    }

    recommendations.sort((a, b) => b.bestScore - a.bestScore);
    return NextResponse.json({ rating, timeframe, generatedAt: new Date().toISOString(), recommendations });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}`;

// Main page component
const pageComponent = `'use client';
import { useState, useEffect } from 'react';

function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' });
}

function getColor(label) {
  if (label === 'perfect') return 'bg-emerald-500';
  if (label === 'flyable') return 'bg-amber-500';
  return 'bg-gray-500';
}

function getBg(label) {
  if (label === 'perfect') return 'bg-emerald-500/10 border-emerald-500/30';
  if (label === 'flyable') return 'bg-amber-500/10 border-amber-500/30';
  return 'bg-gray-500/10 border-gray-500/30';
}

function Card({ rec, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  const win = rec.windowStart && rec.windowEnd ? fmtTime(rec.windowStart) + ' - ' + fmtTime(rec.windowEnd) : 'No good windows';
  const mapsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + rec.site.launchLat + ',' + rec.site.launchLon;

  return (
    <div className={'border rounded-lg overflow-hidden ' + getBg(rec.bestLabel)}>
      <button onClick={() => setOpen(!open)} className="w-full text-left p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white">{rec.site.name}</h3>
              {rec.site.requiresSupervision && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Supervised</span>}
              {rec.site.requiresRadio && <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Radio</span>}
            </div>
            <p className="text-sm text-gray-400">{rec.site.region}</p>
          </div>
          <div className={'px-2 py-1 rounded text-sm font-medium text-white ' + getColor(rec.bestLabel)}>{rec.bestScore}</div>
        </div>
        {open && (
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Best Window</span><p className="text-white">{win}</p></div>
              <div><span className="text-gray-500">Good Hours</span>
                <p className="text-white">
                  {rec.perfectHoursCount > 0 && <span className="text-emerald-400">{rec.perfectHoursCount} perfect</span>}
                  {rec.perfectHoursCount > 0 && rec.flyableHoursCount > 0 && ', '}
                  {rec.flyableHoursCount > 0 && <span className="text-amber-400">{rec.flyableHoursCount} flyable</span>}
                  {rec.perfectHoursCount === 0 && rec.flyableHoursCount === 0 && <span className="text-gray-500">None</span>}
                </p>
              </div>
            </div>
            {rec.bestReasons.length > 0 && (
              <div className="mt-3">
                <span className="text-gray-500 text-sm">Notes</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {rec.bestReasons.map((r, i) => <span key={i} className="text-xs bg-gray-700/50 text-gray-300 px-2 py-1 rounded">{r}</span>)}
                </div>
              </div>
            )}
            <div className="mt-3">
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300" onClick={(e) => e.stopPropagation()}>Get Directions &rarr;</a>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

export default function Home() {
  const [rating, setRating] = useState('PG3');
  const [timeframe, setTimeframe] = useState('today');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/recommendations?rating=' + rating + '&timeframe=' + timeframe)
      .then(res => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [rating, timeframe]);

  const perfect = data?.recommendations?.filter(r => r.bestLabel === 'perfect') || [];
  const flyable = data?.recommendations?.filter(r => r.bestLabel === 'flyable') || [];
  const avoid = data?.recommendations?.filter(r => r.bestLabel === 'avoid') || [];

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">FlyNSW</h1>
          <p className="text-gray-400 text-sm">Paragliding Site Conditions</p>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex bg-gray-800 rounded-lg p-1">
            {['PG2', 'PG3', 'PG4', 'PG5'].map(r => (
              <button key={r} onClick={() => setRating(r)} className={'px-3 py-1.5 rounded-md text-sm font-medium ' + (rating === r ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white')}>{r}</button>
            ))}
          </div>
          <div className="flex bg-gray-800 rounded-lg p-1">
            {[{v: 'now', l: 'Now'}, {v: 'today', l: 'Today'}, {v: 'tomorrow', l: 'Tomorrow'}].map(t => (
              <button key={t.v} onClick={() => setTimeframe(t.v)} className={'px-3 py-1.5 rounded-md text-sm font-medium ' + (timeframe === t.v ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white')}>{t.l}</button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-white"></div>
            <p className="mt-4 text-gray-400">Loading...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {perfect.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>Perfect ({perfect.length})
                </h2>
                <div className="space-y-3">{perfect.map(r => <Card key={r.site.id} rec={r} />)}</div>
              </section>
            )}
            {flyable.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>Flyable ({flyable.length})
                </h2>
                <div className="space-y-3">{flyable.map(r => <Card key={r.site.id} rec={r} />)}</div>
              </section>
            )}
            {avoid.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-500 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-500"></span>Not Recommended ({avoid.length})
                </h2>
                <div className="space-y-3">{avoid.map(r => <Card key={r.site.id} rec={r} collapsed />)}</div>
              </section>
            )}
          </div>
        )}
        <footer className="mt-12 pt-6 border-t border-gray-800 text-center text-gray-500 text-sm">
          <p>Weather: Open-Meteo. Always verify conditions before flying.</p>
        </footer>
      </div>
    </main>
  );
}`;

// Write files
fs.mkdirSync('/var/www/flynsw/src/app/api/recommendations', { recursive: true });
fs.writeFileSync('/var/www/flynsw/src/app/api/recommendations/route.ts', apiRoute);
fs.writeFileSync('/var/www/flynsw/src/app/page.tsx', pageComponent);

console.log('Frontend files created successfully!');
