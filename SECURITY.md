# Security

## Reporting a vulnerability

Do not post exploit details, credentials, private diagrams, or personal data in
public issues, pull requests, or logs.

If GitHub offers **Security → Report a vulnerability** for this repository, use
that private reporting channel. If the option is unavailable, open an issue
containing only a request for a private security contact. Wait for a maintainer
to arrange a private channel before sharing the report. A private reporting
channel and a response deadline are not guaranteed during this early preview.

In the private report, include the affected commit/version, prerequisites,
reproduction steps, potential impact, and a minimal example with synthetic data.

## Supported versions

Security fixes target the latest `main` branch during the preview period.
There are no separately maintained release branches or long-term support versions.

## Local trust boundary

OpenChart has no hosted account or synchronization service. Diagram files,
exports, journals, and backups may still contain sensitive information; protect
and share them accordingly. The application is not a sandbox for untrusted agents.

The live desktop MCP service binds to loopback and authenticates requests with a
bearer token. The discovery file at `%LOCALAPPDATA%/OpenChart/mcp.json` contains
that token and is restricted to the current Windows account. Do not commit it,
forward the loopback port, or give it to an untrusted process. An authorized agent
can read and modify the document exposed by its session.

Diagrams can contain external hyperlinks. Open them only when you trust their
destination. Review third-party documents and dependency changes with the same
care as other local project inputs.
