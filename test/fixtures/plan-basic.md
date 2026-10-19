# Billing export Plan

**Goal:** CSV export of invoices plus a billing helper.
**Spec:** docs/relay/specs/billing-export.md

## Global Constraints

- Amounts are integers in cents everywhere.

## Tasks

### T1: Export schema
Schema type.

### T2: CSV writer
Writer.

### T3: Export endpoint
Endpoint.

### T4: README section
Docs.

### T5: Rounding helper
Helper in src/billing/.

### T6: Billing route
Uses T5 helper, registers in routes index.

```relay-plan
{
  "slug": "billing-export",
  "suite": "true",
  "tasks": [
    { "id": "T1", "title": "Export schema", "tier": "cheap", "code": "complete", "risk": "low", "files": ["src/export/schema.ts"], "tests": 0, "done": "true" },
    { "id": "T2", "title": "CSV writer", "tier": "mid", "risk": "medium", "files": ["src/export/csv.ts", "src/export/csv.test.ts"], "deps": ["T1"], "behaviors": ["two decimals", "rfc4180 quoting"], "tests": 2, "done": "true" },
    { "id": "T3", "title": "Export endpoint", "tier": "mid", "risk": "high", "files": ["src/routes/export.ts", "src/routes/index.ts"], "deps": ["T2"], "behaviors": ["csv body", "401"], "tests": 2, "done": "true" },
    { "id": "T4", "title": "README section", "tier": "cheap", "code": "complete", "risk": "low", "files": ["README.md"], "tests": 0, "done": "true" },
    { "id": "T5", "title": "Rounding helper", "tier": "mid", "risk": "medium", "files": ["src/billing/"], "behaviors": ["rounds half even"], "tests": 1, "done": "true" },
    { "id": "T6", "title": "Billing route", "tier": "strong", "risk": "high", "files": ["src/routes/billing.ts", "src/routes/index.ts"], "deps": ["T5"], "behaviors": ["returns totals"], "tests": 1, "done": "true" }
  ]
}
```
