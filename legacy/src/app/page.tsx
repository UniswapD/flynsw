'use client';
import { useState, useEffect } from 'react';

interface TimeRange { start: string; end: string; }
interface Links { maps: string; windy: string; holfuy?: string; webcam?: string; siteGuide?: string; }

interface SiteRec {
  site: { 
    id: string; name: string; slug: string; region: string; minRating: string; 
    requiresSupervision: boolean; requiresRadio: boolean; requiresInduction: boolean; 
    launchLat: number; launchLon: number; idealWindDirection: number; hasLiveWeather: boolean;
  };
  bestScore: number; bestLabel: string; warnings: string[]; info: string[];
  bestTime: string;
  wind: { speed: number; gust: number; direction: number; directionCompass: string; gustSpread: number; angleOff: number; temp: number; };
  windowStart: string | null; windowEnd: string | null;
  perfectRanges: TimeRange[]; flyableRanges: TimeRange[];
  perfectHoursCount: number; flyableHoursCount: number; confidence: number;
  links: Links;
}

type Rating = 'PG2' | 'PG3' | 'PG4' | 'PG5';
const RATING_ORDER: Rating[] = ['PG2', 'PG3', 'PG4', 'PG5'];

function fmtTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-AU', { hour: 'numeric', hour12: true, timeZone: 'Australia/Sydney' }).toLowerCase();
}

function fmtRange(range: TimeRange): string {
  const start = fmtTime(range.start);
  const end = fmtTime(range.end);
  return start === end ? start : `${start}-${end}`;
}

function degToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function getScoreColor(label: string): string {
  if (label === 'perfect') return 'bg-emerald-500';
  if (label === 'flyable') return 'bg-amber-500';
  return 'bg-gray-500';
}

function getCardBg(label: string): string {
  if (label === 'perfect') return 'bg-emerald-500/10 border-emerald-500/30';
  if (label === 'flyable') return 'bg-amber-500/10 border-amber-500/30';
  return 'bg-gray-500/10 border-gray-500/30';
}

function needsSupervision(pilotRating: string, siteMinRating: string, siteRequiresSupervision: boolean): boolean {
  if (!siteRequiresSupervision) return false;
  if (pilotRating === 'PG2') return true;
  return pilotRating === siteMinRating;
}

function Card({ rec, pilotRating, collapsed = false }: { rec: SiteRec; pilotRating: string; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  
  const idealCompass = degToCompass(rec.site.idealWindDirection);
  const directionStatus = rec.wind.angleOff <= 10 ? 'On direction' : rec.wind.angleOff <= 25 ? `${rec.wind.angleOff}° off` : `${rec.wind.angleOff}° off ideal`;
  const showSupervised = needsSupervision(pilotRating, rec.site.minRating, rec.site.requiresSupervision);
  const pilotLevel = RATING_ORDER.indexOf(pilotRating as Rating);
  const siteLevel = RATING_ORDER.indexOf(rec.site.minRating as Rating);
  const isOverqualified = pilotLevel > siteLevel;

  return (
    <div className={`border rounded-lg overflow-hidden ${getCardBg(rec.bestLabel)}`}>
      <button onClick={() => setOpen(!open)} className="w-full text-left p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-white">{rec.site.name}</h3>
              <span className="text-xs text-gray-400">{rec.site.minRating}+</span>
              {showSupervised && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Supervised</span>}
              {rec.site.requiresRadio && <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Radio</span>}
              {rec.site.requiresInduction && <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Induction</span>}
              {rec.site.hasLiveWeather && <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">📡 Live</span>}
            </div>
            <p className="text-sm text-gray-400">{rec.site.region}</p>
          </div>
          <div className={`px-3 py-1.5 rounded text-lg font-bold text-white ${getScoreColor(rec.bestLabel)}`}>
            {rec.bestScore}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Wind:</span>
            <span className="text-white font-medium">
              {rec.wind.directionCompass} {rec.wind.speed}kt
              {rec.wind.gust > rec.wind.speed && <span className="text-gray-400"> gusts {rec.wind.gust}kt</span>}
            </span>
          </div>
          <span className="text-gray-500">|</span>
          <span className={rec.wind.angleOff <= 15 ? 'text-emerald-400' : rec.wind.angleOff <= 25 ? 'text-amber-400' : 'text-red-400'}>
            {directionStatus}
          </span>
          <span className="text-gray-500">|</span>
          <span className="text-gray-400">{rec.wind.temp}°C</span>
        </div>

        {open && (
          <div className="mt-4 pt-4 border-t border-gray-700/50 space-y-3">
            {rec.perfectRanges.length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-emerald-400 font-medium min-w-[70px]">Perfect:</span>
                <span className="text-white">
                  {rec.perfectRanges.map((r, i) => <span key={i}>{i > 0 && ', '}{fmtRange(r)}</span>)}
                  <span className="text-gray-400 ml-1">({rec.perfectHoursCount}hr{rec.perfectHoursCount !== 1 ? 's' : ''})</span>
                </span>
              </div>
            )}

            {rec.flyableRanges.length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-amber-400 font-medium min-w-[70px]">Flyable:</span>
                <span className="text-white">
                  {rec.flyableRanges.map((r, i) => <span key={i}>{i > 0 && ', '}{fmtRange(r)}</span>)}
                  <span className="text-gray-400 ml-1">({rec.flyableHoursCount}hr{rec.flyableHoursCount !== 1 ? 's' : ''})</span>
                </span>
              </div>
            )}

            {rec.perfectRanges.length === 0 && rec.flyableRanges.length === 0 && (
              <div className="text-sm text-gray-400">No suitable flying windows today</div>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Ideal direction:</span>
              <span className="text-white">{idealCompass} ({rec.site.idealWindDirection}°)</span>
            </div>

            {rec.warnings.length > 0 && (
              <div className="space-y-1.5 pt-2">
                {rec.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-400">⚠️</span>
                    <span className="text-amber-300">{w}</span>
                  </div>
                ))}
              </div>
            )}

            {rec.info.length > 0 && (
              <div className="space-y-1.5">
                {rec.info.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-blue-400">ℹ️</span>
                    <span className="text-gray-300">{n}</span>
                  </div>
                ))}
              </div>
            )}

            {isOverqualified && rec.bestLabel !== 'avoid' && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-emerald-400">✓</span>
                <span className="text-gray-400">You're {pilotRating} at a {rec.site.minRating} site - no supervision needed</span>
              </div>
            )}

            {/* External Links */}
            <div className="pt-3 flex flex-wrap gap-3 text-xs">
              <a href={rec.links.maps} target="_blank" rel="noopener noreferrer" 
                 className="text-blue-400 hover:text-blue-300 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                📍 Directions
              </a>
              <a href={rec.links.windy} target="_blank" rel="noopener noreferrer"
                 className="text-blue-400 hover:text-blue-300 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                🌬️ Windy
              </a>
              {rec.links.holfuy && (
                <a href={rec.links.holfuy} target="_blank" rel="noopener noreferrer"
                   className="text-green-400 hover:text-green-300 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  📡 Live Weather
                </a>
              )}
              {rec.links.siteGuide && (
                <a href={rec.links.siteGuide} target="_blank" rel="noopener noreferrer"
                   className="text-purple-400 hover:text-purple-300 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  📖 Site Guide
                </a>
              )}
              {rec.links.webcam && (
                <a href={rec.links.webcam} target="_blank" rel="noopener noreferrer"
                   className="text-pink-400 hover:text-pink-300 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  📷 Webcam
                </a>
              )}
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
  const [data, setData] = useState<{ recommendations: SiteRec[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/recommendations?rating=${rating}&timeframe=${timeframe}`)
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
          <p className="text-gray-400 text-sm">Paragliding conditions for NSW coastal sites</p>
        </div>
      </header>
      
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex bg-gray-800 rounded-lg p-1">
            {['PG2', 'PG3', 'PG4', 'PG5'].map(r => (
              <button key={r} onClick={() => setRating(r)} 
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${rating === r ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white'}`}>
                {r}
              </button>
            ))}
          </div>
          <div className="flex bg-gray-800 rounded-lg p-1">
            {[{v: 'now', l: 'Now'}, {v: 'today', l: 'Today'}, {v: 'tomorrow', l: 'Tomorrow'}].map(t => (
              <button key={t.v} onClick={() => setTimeframe(t.v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${timeframe === t.v ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white'}`}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-white"></div>
            <p className="mt-4 text-gray-400">Loading conditions...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {perfect.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Perfect Conditions ({perfect.length})
                </h2>
                <div className="space-y-3">{perfect.map(r => <Card key={r.site.id} rec={r} pilotRating={rating} />)}</div>
              </section>
            )}
            
            {flyable.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  Flyable ({flyable.length})
                </h2>
                <div className="space-y-3">{flyable.map(r => <Card key={r.site.id} rec={r} pilotRating={rating} />)}</div>
              </section>
            )}
            
            {avoid.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-500 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                  Not Recommended ({avoid.length})
                </h2>
                <div className="space-y-3">{avoid.map(r => <Card key={r.site.id} rec={r} pilotRating={rating} collapsed />)}</div>
              </section>
            )}

            {perfect.length === 0 && flyable.length === 0 && avoid.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p>No sites available for {rating} pilots</p>
              </div>
            )}
          </div>
        )}

        <footer className="mt-12 pt-6 border-t border-gray-800 text-center text-gray-500 text-sm space-y-1">
          <p>Weather data: Open-Meteo (updates every 5 min)</p>
          <p>Always verify conditions on site before flying</p>
        </footer>
      </div>
    </main>
  );
}
