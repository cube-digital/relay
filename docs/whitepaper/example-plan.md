# Multi-tenant billing Plan

Illustrative 30-task plan used by the relay whitepaper figures. Run `relay lanes` or `relay forecast` on it.

## Tasks

### T1: Tenant table
Tenant table.

### T2: Tenant-scoped queries
Tenant-scoped queries.

### T3: Row-level access policy
Row-level access policy.

### T4: Plan limits config
Plan limits config.

### T5: Feature flags
Feature flags.

### T6: Config loader
Config loader.

### T7: Tenancy guide
Tenancy guide.

### T8: Migration notes
Migration notes.

### T9: API changelog
API changelog.

### T10: Money type
Money type.

### T11: Proration math
Proration math.

### T12: Date ranges
Date ranges.

### T13: Tenant CRUD
Tenant CRUD.

### T14: Invites
Invites.

### T15: Tenant switching
Tenant switching.

### T16: Usage events
Usage events.

### T17: Usage aggregation
Usage aggregation.

### T18: Overage rules
Overage rules.

### T19: Nightly rollup job
Nightly rollup job.

### T20: Retry policy
Retry policy.

### T21: Idempotent writes
Idempotent writes.

### T22: Tenant menu
Tenant menu.

### T23: Members page
Members page.

### T24: Invite flow
Invite flow.

### T25: Invoice lines
Invoice lines.

### T26: Proration on plan change
Proration on plan change.

### T27: Tax per tenant
Tax per tenant.

### T28: E2E fixtures
E2E fixtures.

### T29: Signup to invoice
Signup to invoice.

### T30: Cross-tenant isolation
Cross-tenant isolation.

```relay-plan
{
 "slug": "multi-tenant-billing",
 "suite": "true",
 "tasks": [
  {
   "id": "T1",
   "title": "Tenant table",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "src/db/db1.ts",
    "src/db/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete"
  },
  {
   "id": "T2",
   "title": "Tenant-scoped queries",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/db/db2.ts",
    "src/db/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T1"
   ],
   "behaviors": [
    "tenant-scoped queries happy path",
    "tenant-scoped queries rejects bad input"
   ]
  },
  {
   "id": "T3",
   "title": "Row-level access policy",
   "tier": "mid",
   "risk": "high",
   "files": [
    "src/db/db3.ts",
    "src/db/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T2"
   ],
   "behaviors": [
    "row-level access policy happy path",
    "row-level access policy rejects bad input"
   ]
  },
  {
   "id": "T4",
   "title": "Plan limits config",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "src/config/cfg1.ts",
    "src/config/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete"
  },
  {
   "id": "T5",
   "title": "Feature flags",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "src/config/cfg2.ts",
    "src/config/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete",
   "deps": [
    "T4"
   ]
  },
  {
   "id": "T6",
   "title": "Config loader",
   "tier": "mid",
   "risk": "low",
   "files": [
    "src/config/cfg3.ts",
    "src/config/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T5"
   ],
   "behaviors": [
    "config loader works"
   ]
  },
  {
   "id": "T7",
   "title": "Tenancy guide",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "docs/tenancy/docs1.ts",
    "docs/tenancy/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete"
  },
  {
   "id": "T8",
   "title": "Migration notes",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "docs/tenancy/docs2.ts",
    "docs/tenancy/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete",
   "deps": [
    "T7"
   ]
  },
  {
   "id": "T9",
   "title": "API changelog",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "docs/tenancy/docs3.ts",
    "docs/tenancy/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete",
   "deps": [
    "T8"
   ]
  },
  {
   "id": "T10",
   "title": "Money type",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "src/util/util1.ts",
    "src/util/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete"
  },
  {
   "id": "T11",
   "title": "Proration math",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/util/util2.ts",
    "src/util/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T10"
   ],
   "behaviors": [
    "proration math happy path",
    "proration math rejects bad input"
   ]
  },
  {
   "id": "T12",
   "title": "Date ranges",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/util/util3.ts",
    "src/util/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T11"
   ],
   "behaviors": [
    "date ranges works"
   ]
  },
  {
   "id": "T13",
   "title": "Tenant CRUD",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/api/tenants/api1.ts",
    "src/api/tenants/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T3"
   ],
   "behaviors": [
    "tenant crud happy path",
    "tenant crud rejects bad input"
   ]
  },
  {
   "id": "T14",
   "title": "Invites",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/api/tenants/api2.ts",
    "src/api/tenants/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T13"
   ],
   "behaviors": [
    "invites happy path",
    "invites rejects bad input"
   ]
  },
  {
   "id": "T15",
   "title": "Tenant switching",
   "tier": "strong",
   "risk": "high",
   "files": [
    "src/api/tenants/api3.ts",
    "src/api/tenants/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T14"
   ],
   "behaviors": [
    "tenant switching happy path",
    "tenant switching rejects bad input"
   ]
  },
  {
   "id": "T16",
   "title": "Usage events",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/api/usage/usage1.ts",
    "src/api/usage/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T3",
    "T12"
   ],
   "behaviors": [
    "usage events happy path",
    "usage events rejects bad input"
   ]
  },
  {
   "id": "T17",
   "title": "Usage aggregation",
   "tier": "mid",
   "risk": "high",
   "files": [
    "src/api/usage/usage2.ts",
    "src/api/usage/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T16"
   ],
   "behaviors": [
    "usage aggregation happy path",
    "usage aggregation rejects bad input"
   ]
  },
  {
   "id": "T18",
   "title": "Overage rules",
   "tier": "strong",
   "risk": "high",
   "files": [
    "src/api/usage/usage3.ts",
    "src/api/usage/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T17"
   ],
   "behaviors": [
    "overage rules happy path",
    "overage rules rejects bad input"
   ]
  },
  {
   "id": "T19",
   "title": "Nightly rollup job",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/worker/worker1.ts",
    "src/worker/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T6"
   ],
   "behaviors": [
    "nightly rollup job works"
   ]
  },
  {
   "id": "T20",
   "title": "Retry policy",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "src/worker/worker2.ts",
    "src/worker/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T19"
   ],
   "behaviors": [
    "retry policy works"
   ]
  },
  {
   "id": "T21",
   "title": "Idempotent writes",
   "tier": "mid",
   "risk": "high",
   "files": [
    "src/worker/worker3.ts",
    "src/worker/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T20"
   ],
   "behaviors": [
    "idempotent writes happy path",
    "idempotent writes rejects bad input"
   ]
  },
  {
   "id": "T22",
   "title": "Tenant menu",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "web/tenants/ui1.ts",
    "web/tenants/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete",
   "deps": [
    "T15"
   ]
  },
  {
   "id": "T23",
   "title": "Members page",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "web/tenants/ui2.ts",
    "web/tenants/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T22"
   ],
   "behaviors": [
    "members page works"
   ]
  },
  {
   "id": "T24",
   "title": "Invite flow",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "web/tenants/ui3.ts",
    "web/tenants/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T23"
   ],
   "behaviors": [
    "invite flow works"
   ]
  },
  {
   "id": "T25",
   "title": "Invoice lines",
   "tier": "mid",
   "risk": "high",
   "files": [
    "src/billing/billing1.ts",
    "src/billing/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T18"
   ],
   "behaviors": [
    "invoice lines happy path",
    "invoice lines rejects bad input"
   ]
  },
  {
   "id": "T26",
   "title": "Proration on plan change",
   "tier": "strong",
   "risk": "high",
   "files": [
    "src/billing/billing2.ts",
    "src/billing/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T25"
   ],
   "behaviors": [
    "proration on plan change happy path",
    "proration on plan change rejects bad input"
   ]
  },
  {
   "id": "T27",
   "title": "Tax per tenant",
   "tier": "strong",
   "risk": "high",
   "files": [
    "src/billing/billing3.ts",
    "src/billing/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T26"
   ],
   "behaviors": [
    "tax per tenant happy path",
    "tax per tenant rejects bad input"
   ]
  },
  {
   "id": "T28",
   "title": "E2E fixtures",
   "tier": "cheap",
   "risk": "low",
   "files": [
    "test/e2e/e2e1.ts",
    "test/e2e/index.ts"
   ],
   "tests": 0,
   "done": "true",
   "code": "complete",
   "deps": [
    "T24",
    "T27"
   ]
  },
  {
   "id": "T29",
   "title": "Signup to invoice",
   "tier": "mid",
   "risk": "medium",
   "files": [
    "test/e2e/e2e2.ts",
    "test/e2e/index.ts"
   ],
   "tests": 1,
   "done": "true",
   "deps": [
    "T28"
   ],
   "behaviors": [
    "signup to invoice works"
   ]
  },
  {
   "id": "T30",
   "title": "Cross-tenant isolation",
   "tier": "strong",
   "risk": "high",
   "files": [
    "test/e2e/e2e3.ts",
    "test/e2e/index.ts"
   ],
   "tests": 2,
   "done": "true",
   "deps": [
    "T29"
   ],
   "behaviors": [
    "cross-tenant isolation happy path",
    "cross-tenant isolation rejects bad input"
   ]
  }
 ]
}
```
