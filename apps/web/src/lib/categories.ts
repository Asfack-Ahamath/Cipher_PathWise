/* Mirrors CATEGORIES in apps/api/src/services/store.ts — per-unit weight and volume used to size an order. */
export const CATEGORIES: Record<string, Partial<Record<'ambient' | 'chilled', { k: string; kg: number; m3: number }[]>>> = {
  Fresh: {
    ambient: [{ k: 'Dry grocery', kg: 22, m3: 0.14 }, { k: 'Beverages', kg: 26, m3: 0.12 }, { k: 'Household', kg: 12, m3: 0.15 }],
    chilled: [{ k: 'Dairy', kg: 28, m3: 0.19 }, { k: 'Meat and fish', kg: 30, m3: 0.2 }, { k: 'Fresh produce', kg: 25, m3: 0.22 }],
  },
  Style: { ambient: [{ k: 'Casualwear (cartons)', kg: 14, m3: 0.28 }, { k: 'Denim and trousers (cartons)', kg: 22, m3: 0.32 }, { k: 'Footwear (boxes)', kg: 16, m3: 0.36 }, { k: 'Hanging garments (rails)', kg: 9, m3: 0.45 }] },
  Tech: { ambient: [{ k: 'Double-door refrigerators', kg: 95, m3: 0.85 }, { k: '65" TVs', kg: 38, m3: 0.45 }, { k: 'Front-load washing machines', kg: 72, m3: 0.55 }, { k: 'Small appliances (cartons)', kg: 8, m3: 0.06 }] },
};
