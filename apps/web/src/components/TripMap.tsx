import { useEffect, useRef } from 'react';
import L from 'leaflet';

/* Open-source map: Leaflet + OpenStreetMap data (CARTO light tiles).
   The dataset has no outlet coordinates, so outlets sit at stable positions around their
   district centre (see packages/core/src/network.ts). Lines are straight stop-to-stop, not roads. */
export type LatLng = [number, number];
export type MapStop = { id: string; seq: number; pos: LatLng; state: 'done' | 'next' | 'conflict' | 'moved' };
export type MapTrip = { key: string; label: string; tone: 'road' | 'offline' | 'depot' | 'done' | 'alert'; pos: LatLng; estimate?: LatLng | null; depot: LatLng; stops: MapStop[] };
const TONE = { road: '#0F766E', offline: '#64748B', depot: '#4F46E5', done: '#059669', alert: '#D97706' };

export default function TripMap({ trips, selected, onSelect, fitKey, className }: { trips: MapTrip[]; selected?: string | null; onSelect?: (k: string) => void; fitKey?: unknown; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const lastFit = useRef<unknown>(Symbol());

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: false }).setView([7.2, 80.3], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current; if (!m || !g) return;
    g.clearLayers();
    const sel = trips.find(t => t.key === selected);
    const draw = sel ? [...trips.filter(t => t.key !== selected), sel] : trips;
    for (const t of draw) {
      const on = !selected || t.key === selected;
      const color = TONE[t.tone];
      const pts: LatLng[] = [t.depot, ...t.stops.map(s => s.pos)];
      if (on && selected) L.polyline(pts, { color, weight: 3, opacity: 0.85, dashArray: t.tone === 'offline' ? '6 6' : undefined }).addTo(g);
      else if (!selected) L.polyline(pts, { color, weight: 1.5, opacity: 0.35 }).addTo(g);
      if (on && selected) for (const s of t.stops) {
        const bg = s.state === 'done' ? '#0F766E' : s.state === 'conflict' ? '#D97706' : s.state === 'moved' ? '#94A3B8' : '#fff';
        const fg = s.state === 'next' ? '#0F172A' : '#fff';
        L.marker(s.pos, { icon: L.divIcon({ className: '', html: `<div class="pw-pin" style="width:22px;height:22px;background:${bg};color:${fg};${s.state === 'next' ? 'border-color:#0F172A' : ''}">${s.seq}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .bindTooltip(`${s.id} · stop ${s.seq}${s.state === 'moved' ? ' · moved' : s.state === 'conflict' ? ' · conflict' : ''}`).addTo(g);
      }
      if (t.estimate && on) {
        L.circleMarker(t.estimate, { radius: 9, color: '#64748B', weight: 2, dashArray: '3 3', fillColor: '#CBD5E1', fillOpacity: 0.5 }).bindTooltip(`${t.label} · estimated from the plan`).addTo(g);
      }
      const size = on && selected ? 30 : 22;
      const mk = L.marker(t.pos, { zIndexOffset: on ? 1000 : 0, icon: L.divIcon({ className: '', html: `<div class="pw-pin" style="width:${size}px;height:${size}px;background:${color};opacity:${on ? 1 : 0.8}">${t.tone === 'offline' ? '⌁' : '▲'}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) })
        .bindTooltip(t.label).addTo(g);
      if (onSelect) mk.on('click', () => onSelect(t.key));
    }
    const fitTo = sel ? [sel.depot, sel.pos, ...sel.stops.map(s => s.pos)] : trips.flatMap(t => [t.depot, t.pos]);
    const key = JSON.stringify([selected, fitKey]);
    if (fitTo.length && lastFit.current !== key) {
      lastFit.current = key;
      m.fitBounds(L.latLngBounds(fitTo as L.LatLngExpression[]).pad(0.2), { maxZoom: 12, animate: false });
    }
  }, [trips, selected, onSelect, fitKey]);

  return <div ref={el} className={className ?? 'w-full h-full'} role="region" aria-label="Map of vehicles and stops" />;
}
