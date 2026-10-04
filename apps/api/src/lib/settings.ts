import { z } from 'zod';
import { DEFAULT_RULES, type PlanningRules } from '@pathwise/core';
import { q, type Db } from '../db.js';

/* Admin-editable settings, validated and cached. `rules` feed the planning engine;
   `operations` drive cut-off, offline detection, receipt timeout and sessions. */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).');

export const RulesSchema = z.object({
  freshBudgetMin: z.number().int().min(60).max(600),
  styleTechBudgetMin: z.number().int().min(60).max(900),
  maxTripsPerVehicle: z.number().int().min(1).max(3),
  freshDepart: hhmm,
  reloadMin: z.number().int().min(0).max(180),
  lateRiskSlackMin: z.number().int().min(0).max(120),
});
export const OperationsSchema = z.object({
  cutoffTime: hhmm,
  offlineAfterMin: z.number().int().min(2).max(120),
  receiptConfirmHours: z.number().min(0.5).max(72),
  sessionHours: z.number().min(1).max(72),
  driverSessionHours: z.number().min(1).max(96),
  loaderClaimMinutes: z.number().int().min(1).max(30),
  useTrafficForEta: z.boolean(),
});
export type Operations = z.infer<typeof OperationsSchema>;
export const DEFAULT_OPERATIONS: Operations = { cutoffTime: '16:00', offlineAfterMin: 10, receiptConfirmHours: 4, sessionHours: 12, driverSessionHours: 24, loaderClaimMinutes: 3, useTrafficForEta: true };

let cache: { rules: PlanningRules; operations: Operations; at: number } | null = null;
const TTL = 15_000;
/** Bumped whenever settings change, so caches built from them (the planning network) know to rebuild. */
let version = 0;
export const settingsVersion = () => version;

export async function getSettings(db?: Db): Promise<{ rules: PlanningRules; operations: Operations }> {
  if (cache && Date.now() - cache.at < TTL && !db) return cache;
  const rows = await q<{ key: string; value: any }>(`SELECT key, value FROM settings WHERE key IN ('rules','operations')`, [], db);
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? {};
  const rules = RulesSchema.safeParse({ ...DEFAULT_RULES, ...get('rules') });
  const operations = OperationsSchema.safeParse({ ...DEFAULT_OPERATIONS, ...get('operations') });
  const out = { rules: rules.success ? rules.data : DEFAULT_RULES, operations: operations.success ? operations.data : DEFAULT_OPERATIONS };
  cache = { ...out, at: Date.now() };
  return out;
}
export async function saveSettings(key: 'rules' | 'operations', value: unknown, db?: Db) {
  const parsed = key === 'rules' ? RulesSchema.parse(value) : OperationsSchema.parse(value);
  await q(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(parsed)], db);
  cache = null; version++;
  return parsed;
}
export const invalidateSettings = () => { cache = null; version++; };
