# Datasets

PathWise reads the five competition datasets from this folder at seed time:

| File | What it holds |
|---|---|
| `outlets.csv` | 120 outlets: brand, district, depot, dock type, parking, receiving hours, mall window |
| `vehicles.csv` | 60 vehicles: type, temperature, depot, weight and volume capacity, km/L, weekly fuel quota and use |
| `district_travel.csv` | Outbound and inter-stop minutes and km per depot and district |
| `service_allowance.csv` | Handling minutes by brand and dock type |
| `calendar.csv` | Operating days, holidays, paydays, festival ramp, monsoon |

Drop the official CSVs here (same file names) before `docker compose up` or `npm run db:seed`.
The loader is tolerant of column order and common header spellings.

If a file is missing, the seed falls back to the copy bundled in `packages/core/src/dataset.ts`
(and a generated calendar for April–June 2026), so the app always starts.

**The CSVs are git-ignored on purpose.** The competition rules say the datasets must not be shared
with third parties, so keep the repository private (add the judges as collaborators) or remove the
bundled copy before making anything public.
