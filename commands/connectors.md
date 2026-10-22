---
description: Record which MCP connectors this session can reach, including claude.ai account connectors, for relay HQ's Brain.
allowed-tools: Bash(relay hq connectors*)
disable-model-invocation: true
---
List the MCP servers whose tools you have in this session. A tool named `mcp__<server>__<tool>` belongs to server `<server>`; count the tools per server. Do not call any of them. Skip servers the app itself provides rather than a connector the user added: ids starting with `ccd_` or `Claude_`, and `terminal`, `visualize`, `scheduled-tasks`, `mcp-registry`.

When a server id is opaque (a UUID or a random string), give it a short label inferred from its tools and set `labelInferred` to true; otherwise the label is the id and `labelInferred` is false.

Pipe exactly this JSON, and nothing else, to `relay hq connectors --record` (on your PATH; run it by name), for example with a quoted heredoc:

{"servers":[{"id":"<server>","label":"<label>","labelInferred":false,"tools":<count>}]}

An empty list is valid. Then reply with one line: how many servers were recorded.
