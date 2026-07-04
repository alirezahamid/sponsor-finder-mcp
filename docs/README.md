# SponsorFinder MCP — Usage

The **SponsorFinder MCP server** lets AI assistants check whether a company holds a
**UK** or **Netherlands** work-visa sponsorship licence, using the public SponsorFinder
data (UK Home Office register of licensed sponsors + Dutch IND register of recognised
sponsors).

- **MCP endpoint:** `https://mcp.sponsorfinder.io/mcp`
- **Transport:** Streamable HTTP (also runs over stdio for local use)
- **Auth:** none — it's a public, read-only server. Connect without credentials.
- **Source:** https://github.com/alirezahamid/sponsor-finder-mcp

## Tools

| Tool                    | What it does                                                                            | Key inputs                                                            |
| ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `check_sponsor_license` | Is this company a licensed sponsor? Returns routes, ratings, locations, register dates. | `company_name`, `country` (`uk`/`nl`/`both`)                          |
| `search_sponsors`       | Exploratory list search with filters.                                                   | `query`, `country`, `city`/`route` (UK), `sponsor_type` (NL), `limit` |
| `get_sponsor_details`   | Full record for one organization by id.                                                 | `org_id`, `country`, `include_history`                                |
| `get_register_info`     | Register stats, data freshness, and terminology.                                        | —                                                                     |

## Important: use registered legal names

The registers list **official registered legal entity names**, not brand, product, or
trading names. When you look a company up, resolve it to its **registered legal name**
first (e.g. from the company's website or the relevant companies register), then query.
A brand name or URL often won't match. The `check_sponsor_license` tool description
instructs assistants to do this automatically.

## Add it to your assistant

| Client                         | How                                                                                                       | Status      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------- |
| **Claude Code**                | `claude mcp add --transport http sponsorfinder https://mcp.sponsorfinder.io/mcp`                          | ✅ Works    |
| **ChatGPT**                    | Add a custom MCP connector with the endpoint URL                                                          | ✅ Works    |
| **Cursor / Codex**             | Add the remote MCP server with the endpoint URL                                                           | ✅ Works    |
| **claude.ai / Claude Desktop** | Settings → Connectors → Add custom connector → paste the **full `/mcp`** URL, leave OAuth Client ID blank | ⚠️ See note |

> **Note for claude.ai / Claude Desktop:** these clients currently force an OAuth
> registration step on every custom connector and may show _"Couldn't register with
> sign-in service / needs authentication"_ for authless servers — a known client-side
> issue ([anthropics/claude-ai-mcp#457](https://github.com/anthropics/claude-ai-mcp/issues/457)),
> not a problem with this server. Use Claude Code, ChatGPT, or Cursor in the meantime.
> Always use the **full** URL ending in `/mcp` (the bare host also works, but `/mcp` is
> canonical).

## Example prompts

- "Does [company] hold a UK sponsorship licence?"
- "Is [company] a recognised sponsor in the Netherlands?"
- "Search UK Skilled Worker sponsors in Manchester."
- "What does a B rating mean?"

## Data & disclaimer

Data comes from the official **UK government sponsor list** (gov.uk) and the **Dutch IND
public register** of recognised sponsors, refreshed regularly. This tool is **informational
and not legal advice** — always verify against the official sources before making decisions.

---

Self-hosting, development, and deployment: see the
[project README](https://github.com/alirezahamid/sponsor-finder-mcp#readme).
