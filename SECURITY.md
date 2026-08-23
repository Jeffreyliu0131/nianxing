# Security

## Supported code

Security fixes target the current `main` branch.

## Reporting

Please report suspected vulnerabilities through GitHub's private security-advisory workflow. Do not post credentials, personal task content, authentication headers, database exports, or production URLs in a public issue.

## Security boundaries

- `.env` is ignored. `DEEPSEEK_API_KEY` is server-only and must never use a `VITE_` prefix.
- The browser calls only the same-origin model gateway. The gateway bounds request size, validates model output and rate-limits authenticated users.
- D1 reads and writes are partitioned by the platform-provided authenticated user ID. Client-supplied user identifiers are not trusted.
- Optimistic revisions and deletion tombstones prevent silent overwrites during offline reconciliation.
- The `oai-authenticated-user-*` headers are trustworthy only when the application runs behind OpenAI Sites. A different hosting platform must strip external copies of these headers and provide its own verified identity layer.
- `.openai/hosting.json` contains no reusable credential or existing Sites project ID.

Before sharing a fork, run the test suite, dependency audit and a secret scanner over both the working tree and Git history.
