# Spike Plan

## Tasks

### T1: Note A
Create notes/a.md with the text "lane a".

### T2: Note B
Create notes/b.md with the text "lane b".

```relay-plan
{
  "slug": "spike",
  "tasks": [
    { "id": "T1", "title": "Note A", "tier": "cheap", "code": "complete", "risk": "low", "files": ["notes/a.md"], "tests": 0, "done": "test -f notes/a.md" },
    { "id": "T2", "title": "Note B", "tier": "cheap", "code": "complete", "risk": "low", "files": ["notes/b.md"], "tests": 0, "done": "test -f notes/b.md" }
  ]
}
```
