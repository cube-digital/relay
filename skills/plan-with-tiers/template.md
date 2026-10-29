# <Feature> Plan

**Goal:** <one sentence>
**Spec:** docs/relay/specs/<file>.md
**Design (when supplied):** <path and revision or dated state; omit when absent>
**Architecture:** <two or three sentences>

## Global Constraints

- <Copy a project-wide rule and its exact values from the spec.>
- <State version floors, naming rules, and error formats.>

## Review Focus

- <List failure modes from the spec that task tests do not cover. The final review checks these.>

## Tasks

### T1: Export schema
Add `ExportRow` to `src/export/schema.ts`:

```ts
export type ExportRow = { id: string; amountCents: number; currency: 'EUR' | 'USD' }
```

### T2: CSV writer
Add `writeCsv(rows: ExportRow[]): string` in `src/export/csv.ts`. Use header `id,amount,currency`. Format amounts as `12.34` with two decimals and a dot. Use RFC 4180 quoting.

### T3: Export endpoint
Make `GET /api/export.csv` stream `writeCsv(await listRows(userId))`. Set `Content-Type: text/csv; charset=utf-8`. Return 401 without a session.

```relay-plan
{
  "slug": "csv-export",
  "suite": "pnpm test",
  "setup": "pnpm install --frozen-lockfile",
  "tasks": [
    {
      "id": "T1", "title": "Export schema", "tier": "cheap", "code": "complete", "risk": "low",
      "files": ["src/export/schema.ts"], "deps": [],
      "behaviors": [], "tests": 0,
      "done": "pnpm tsc --noEmit -p ."
    },
    {
      "id": "T2", "title": "CSV writer", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["src/export/csv.ts", "src/export/csv.test.ts"], "deps": ["T1"],
      "behaviors": ["amounts render with two decimals", "fields with commas or quotes are quoted per RFC 4180"],
      "tests": 2,
      "done": "pnpm vitest run src/export/csv.test.ts"
    },
    {
      "id": "T3", "title": "Export endpoint", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["src/routes/export.ts", "src/routes/index.ts", "test/export.e2e.test.ts"], "deps": ["T2"],
      "behaviors": ["returns the user's rows as CSV", "401 without a session"],
      "tests": 2,
      "done": "pnpm vitest run test/export.e2e.test.ts"
    }
  ]
}
```
