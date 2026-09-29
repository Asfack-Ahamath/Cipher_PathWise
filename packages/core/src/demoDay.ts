import type { Order, Outlet } from './types.js';

/* ──────────────────────────────────────────────────────────────────────────
   The seeded delivery day: Thu 30 Apr 2026 (payday; Fri 1 May is Vesak, so
   the next run is Sat 2 May). 143 confirmed orders, as in the Day-5 design:
   every Fresh outlet orders dry groceries (80), 52 also order chilled goods,
   5 Style outlets have their weekly delivery and 6 Tech outlets ordered.
   Order sizes are generated deterministically (the datasets have no order
   sizes), so every fresh install plans the same day.
   ────────────────────────────────────────────────────────────────────────── */
export const DEMO_DAY = {
  date: '2026-04-30',
  label: 'Thu 30 Apr',
  cutoff: '2026-04-29T16:00',
  nextRun: '2026-05-02',
  nextRunLabel: 'Sat 2 May',
  why: 'Fri 1 May is Vesak — not an operating day',
};

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const STYLE_TODAY = ['OUT015', 'OUT016', 'OUT017', 'OUT089', 'OUT090'];
const TECH_TODAY = ['OUT023', 'OUT024', 'OUT039', 'OUT058', 'OUT094', 'OUT095'];
/* Outlets skipped on Wed 29 Apr — the plan must serve them first today (repeat-skip protection). */
export const SKIPPED_YESTERDAY = ['OUT116', 'OUT030', 'OUT079'];

/** Fixed orders for the walkthrough route (Kandy DC → Kegalle). */
const HERO: Record<string, Partial<Order>[]> = {
  OUT117: [{ id: 'ORD0093171', temp: 'chilled', units: 12, kg: 360, m3: 2.4, description: 'Chilled crates' }, { id: 'ORD0093176', temp: 'ambient', units: 14, kg: 300, m3: 1.9, description: 'Ambient cartons' }],
  OUT118: [{ id: 'ORD0093172', temp: 'ambient', units: 15, kg: 330, m3: 2.1, description: 'Ambient cartons' }],
  OUT116: [{ id: 'ORD0093173', temp: 'chilled', units: 12, kg: 350, m3: 2.4, description: 'Dairy — 6 yoghurt cases + dairy' }, { id: 'ORD0093174', temp: 'ambient', units: 16, kg: 340, m3: 2.2, description: 'Ambient cartons' }],
  OUT119: [{ id: 'ORD0093175', temp: 'chilled', units: 11, kg: 330, m3: 2.2, description: 'Chilled crates' }, { id: 'ORD0093177', temp: 'ambient', units: 13, kg: 290, m3: 1.8, description: 'Ambient cartons' }],
};

export function generateDemoOrders(outlets: Outlet[], date = DEMO_DAY.date): Order[] {
  const r = rng(20260430);
  const orders: Order[] = [];
  let n = 93300;
  const nextId = () => `ORD00${n++}`;
  const fresh = outlets.filter(o => o.brand === 'Fresh').sort((a, b) => a.id.localeCompare(b.id));
  // 52 of the 80 Fresh outlets have a chilled order today: every outlet in the hero district and
  // the skipped outlets, then a stable pick of the rest
  const chilledSet = new Set<string>([...Object.keys(HERO).filter(id => HERO[id].some(x => x.temp === 'chilled')), ...SKIPPED_YESTERDAY]);
  for (const o of fresh) { if (chilledSet.size >= 52) break; if (!HERO[o.id] && r() < 0.62) chilledSet.add(o.id); }
  for (const o of fresh) if (chilledSet.size < 52 && !HERO[o.id]) chilledSet.add(o.id);

  for (const o of fresh) {
    const skipped = SKIPPED_YESTERDAY.includes(o.id);
    if (HERO[o.id]) {
      for (const h of HERO[o.id]) orders.push({ outletId: o.id, date, units: 0, kg: 0, m3: 0, temp: 'ambient', ...h, id: h.id!, deferredYesterday: skipped && h.temp === 'chilled', daysSinceServed: skipped && h.temp === 'chilled' ? 2 : 1 } as Order);
      continue;
    }
    const au = 12 + Math.floor(r() * 7);
    orders.push({ id: nextId(), outletId: o.id, date, temp: 'ambient', units: au, kg: Math.round(au * (20 + r() * 4)), m3: round1(au * (0.12 + r() * 0.04)), daysSinceServed: 1, description: 'Ambient cartons' });
    if (chilledSet.has(o.id)) {
      const cu = 8 + Math.floor(r() * 8);
      orders.push({ id: nextId(), outletId: o.id, date, temp: 'chilled', units: cu, kg: Math.round(cu * (28 + r() * 5)), m3: round1(cu * (0.18 + r() * 0.04)), deferredYesterday: skipped, daysSinceServed: skipped ? 2 : 1, description: 'Chilled crates' });
    }
  }
  for (const id of STYLE_TODAY) {
    const u = 50 + Math.floor(r() * 13);
    orders.push({ id: nextId(), outletId: id, date, temp: 'ambient', units: u, kg: Math.round(u * 11), m3: round1(u * (0.15 + r() * 0.02)), daysSinceServed: 7, description: 'Hanging garments and cartons' });
  }
  for (const id of TECH_TODAY) {
    const u = 1 + Math.floor(r() * 3);
    orders.push({ id: nextId(), outletId: id, date, temp: 'ambient', units: u, kg: Math.round(u * (280 + r() * 120)), m3: round1(u * (1.1 + r() * 0.4)), daysSinceServed: 3, description: u === 1 ? 'Double-door refrigerator' : 'Appliances (TVs, washers)' });
  }
  return orders;
}
const round1 = (x: number) => Math.round(x * 10) / 10;
