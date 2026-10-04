# Datasets

PathWise reads the competition datasets from this folder at seed time. Put the files here directly,
or unzip the official pack so that `data/General Data/…` exists — both layouts work.

| File | Used for |
|---|---|
| `outlets.csv` | 120 outlets: brand, district, depot, dock type, parking, receiving hours, mall window |
| `vehicles.csv` | 60 vehicles: type, temperature, depot, weight and volume capacity, km/L, weekly fuel quota |
| `district_travel.csv` | Free-flow outbound and inter-stop minutes and km per depot and district |
| `service_allowance.csv` | Handling minutes by brand and dock type |
| `calendar.csv` | Operating days, paydays, festivals and ramp, public holidays, monsoon, ISO weeks |
| `traffic_speed.csv` | Speed index by district, hour and monsoon → expected arrival times |
| `road_conditions.csv` | Date-specific disruption index by district → expected arrival times |

Training and test data (`deliveries_train.csv`, `route_legs_*.csv`, `task1/2a/2b_*`) were used offline to
derive the weekly demand history, the Task 2A forecast horizon and the Task 2B peak day; the compact results
are generated into `packages/core/src/datasetExtra.ts` by `node scripts/bundle-datasets.mjs "<path to data>"`.

If a file is missing, the seed falls back to the rows bundled in `packages/core`, so the app always starts.

**Nothing in this folder is committed** (`.gitignore` excludes every CSV, ZIP and spreadsheet under `data/`).
So that the app always starts, compact tables derived from the reference data are bundled in
`packages/core/src/dataset.ts` and `datasetExtra.ts`; the seed uses them when a file is missing.
