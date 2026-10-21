# <Feature> Plan

**Goal:** <one sentence>
**Spec:** docs/relay/specs/<file>.md
**Architecture:** <two or three sentences>

## Global Constraints

- <project-wide rule with exact values, copied from the spec>
- <version floors, naming rules, error format, ...>

## Review Focus

- <failure modes the spec implies that no task's tests exercise; the final review looks here>

## Tasks

### T1: Export schema
Add `ExportRow` to `src/export/schema.ts`:

```ts
export type ExportRow = { id: string; amountCents: number; currency: 'EUR' | 'USD' }
```

### T2: CSV writer
`writeCsv(rows: ExportRow[]): string` in `src/export/csv.ts`. Header `id,amount,currency`; amount as `12.34` (two decimals, dot); RFC 4180 quoting.

### T3: Export endpoint
`GET /api/export.csv` streams `writeCsv(await listRows(userId))`, `Content-Type: text/csv; charset=utf-8`, 401 without a session.

```relay-plan
{
  "slug": "csv-export",
  "flow": "feature",
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
      "tags": ["api"],
      "behaviors": ["returns the user's rows as CSV", "401 without a session"],
      "tests": 2,
      "done": "pnpm vitest run test/export.e2e.test.ts"
    }
  ]
}
```
