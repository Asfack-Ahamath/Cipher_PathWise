/* Printable run sheet for a trip: stop order, windows, lines to load and a signature column.
   Opened in a new window and printed from there (works with the browser's "Save as PDF"). */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function printRunSheet(trip: any, outlets: Map<string, any>) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { alert('Allow pop-ups for PathWise to print the run sheet.'); return; }
  const rows = trip.stops.map((s: any) => {
    const o = outlets.get(s.outletId) ?? s.outlet ?? {};
    const lines = (s.lines ?? []).map((l: any) => `${esc(l.orderId)} · ${esc(l.temp)} · ${esc(l.units)} units${l.loadedUnits != null && l.loadedUnits !== l.units ? ` (loaded ${esc(l.loadedUnits)})` : ''} — ${esc(l.description ?? '')}`).join('<br>');
    return `<tr><td class="n">${esc(s.seq)}</td><td><b>${esc(s.outletId)}</b><br><span class="m">${esc(o.name ?? '')}</span></td><td>${esc(s.arrive)}</td><td>${esc(o.open ?? '')}–${esc(o.close ?? '')}${o.mallWindow ? `<br><span class="m">Mall ${esc(o.mallWindow)}</span>` : ''}</td><td class="m">${lines}</td><td class="sig"></td></tr>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Run sheet ${esc(trip.vehicleId)} Trip ${esc(trip.trip)}</title>
  <style>body{font:12px/1.4 system-ui,sans-serif;color:#0f172a;margin:24px}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.n{width:24px;text-align:center;font-weight:700}.m{color:#475569;font-size:11px}.sig{width:140px}.meta{display:flex;gap:18px;margin-top:6px;color:#334155}@media print{body{margin:10mm}button{display:none}}</style></head><body>
  <h1>${esc(trip.vehicleId)} · Trip ${esc(trip.trip)} · ${esc(trip.date)}</h1>
  <div class="meta"><span>Driver: <b>${esc(trip.vehicle?.driverName ?? '')}</b></span><span>Departs ${esc(trip.depart)}</span><span>${esc(trip.brand)} · ${esc(trip.district)}</span><span>${esc(Math.round(trip.kg))} kg · ${esc(Number(trip.m3).toFixed(1))} m³</span><span>Trip time ${esc(trip.tripMinutes)} of ${esc(trip.budget)} min</span><span>Plan v${esc(trip.planVersion)}</span></div>
  <table><thead><tr><th>#</th><th>Outlet</th><th>ETA</th><th>Window</th><th>Lines</th><th>Received by / signature</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="m" style="margin-top:14px">Printed from PathWise. The phone app is the record of delivery; use this sheet if the phone is lost or broken.</p>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
