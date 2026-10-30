## Brett Adams

Fourth-year Computer Science (Software Engineering) at the **University of Windsor**, currently a **Data Analyst Intern at Geotab** working in BigQuery, Airflow, and SQL.

I like building the unglamorous layer — auth flows, data plumbing, the tool that removes a manual step — and writing down *why* it works the way it does.

[Portfolio](https://brettadams0.github.io/) · [MCP case study](https://brettadams0.github.io/mcp/) · [LinkedIn](https://www.linkedin.com/in/bretta/) · [Résumé](https://brettadams0.github.io/assets/resume/Resume_BrettAdams.pdf)

---

### Selected work

**[mcp-surface](https://github.com/brettadams0/mcp-surface)** — `TypeScript` `MCP` `CLI` · [on npm](https://www.npmjs.com/package/mcp-surface)
A broken MCP server usually doesn't look broken. It starts, it completes the handshake, the client lists it as **Connected** — and the model never calls anything, because the tool surface came back empty, a schema didn't compile, or a `required` field names a property that isn't there. Nothing errors; you just get worse answers. `mcp-surface` connects the way a real client does, reports the surface it actually sees, validates every schema, and fails CI when that surface changes without you meaning it to. Ships as a CLI and a GitHub Action. It paid for itself on day one: a routine Zod 3 → 4 upgrade passed every unit test in my Google Workspace server, and `mcp-surface` failed the build because all 23 tool schemas had changed underneath them.

**[google-workspace-mcp](https://github.com/brettadams0/google-workspace-mcp)** — `Node` `OAuth 2.0` `MCP`
An MCP server that gives Claude Code write access to Gmail, Calendar, Drive, Sheets, and YouTube. 23 tools over 5 Google APIs, running on an OAuth client I own rather than a hosted connector. It requests no Google "Restricted" scopes — `gmail.readonly` and `drive.readonly` would drag a single-user tool into a paid CASA security audit — so it can send mail but not read the inbox, and reading is left to the connectors that already do it well. Every tool argument is treated as untrusted model output: a subject line that smuggles in a `Bcc:` header is refused, and cell values are written as plain text so `=IMPORTDATA(…)` can't run as a formula, each with a test that builds the attack. Tested in CI without credentials or network.

**Four more servers on the same harness** — [reddit-mcp](https://github.com/brettadams0/reddit-mcp) · [chesscom-mcp](https://github.com/brettadams0/chesscom-mcp) · [supercell-mcp](https://github.com/brettadams0/supercell-mcp) · [yahoo-fantasy-mcp](https://github.com/brettadams0/yahoo-fantasy-mcp)
46 more tools from one shared harness. `reddit-mcp` posts, comments and votes as your account, and turns the HTTP 200 that Reddit sends back with a rejected post into a real error, so the model can't announce a post that never went up. `chesscom-mcp`, `supercell-mcp` (three game APIs in one server) and `yahoo-fantasy-mcp` (OAuth with refresh-token rotation) are read-only. Each commits an `mcp-surface.json`, and CI fails when a tool changes shape without that file changing with it.

Writing MCP servers is where `mcp-surface` came from: the same failures kept recurring, none of them announced themselves, and every one was visible in the tool surface if you actually looked at it. The [case study](https://brettadams0.github.io/mcp/) covers how the three fit together and what a security review of the servers turned up.

**[border-waits-pipeline](https://github.com/brettadams0/border-waits-pipeline)** — `Python` `dbt` `DuckDB` `GitHub Actions` · [live](https://brettadams0.github.io/border-waits/)
An hourly pipeline over the border wait estimates Canada and the U.S. publish, which agree on almost nothing: CBP stamps a reading "At Noon EDT" and means the hour about to start, Port Huron reports `EST` in October, and the two sides of one crossing sit in different IANA zones. The models are dbt on DuckDB, tested on recorded HTTP fixtures so the suite runs with no network. When a run fails it redeploys the last good export with a `status.json` naming the step that broke, opens one issue, and closes it on the next good run — so the dashboard degrades to stale rather than wrong. You can query the whole history with SQL in the browser.

**[PromptPal](https://github.com/brettadams0/PromptPal)** — `TypeScript` `Next.js` `React` · [live](https://prompt-pal-gules.vercel.app)
A browser tool for writing prompt templates, with its own small template language and a parser that reports errors by line and column. It fills a template in, flags empty required fields and leftover placeholders like "[insert topic]", and exports plain text or a ready-to-run Claude API call. No backend: a share link carries the prompt in the URL fragment.

**[TechNest](https://github.com/brettadams0/TechNest)** — `PHP` `MySQL` `SQLite` `Docker`
An electronics store in PHP with no framework: search, cart, checkout, order tracking, and an admin dashboard. Checkout is one database transaction that takes stock with a conditional update, so the last unit can't sell twice; CSRF and access-control checks run before any page code, and the tests walk the route table to prove it. 200+ tests run against SQLite and MySQL in CI.

**[neuronet-arena](https://github.com/brettadams0/neuronet-arena)** — `Python` `JavaScript` `Genetic Algorithms`
Agents driven by small hand-rolled neural networks compete for food and evolve across generations. No ML framework: the network, the genetic algorithm and the random number generator are written from scratch in Python, then ported to JavaScript for a [live demo](https://brettadams0.github.io/neuronet-arena/) that reproduces the Python run bit for bit. The README covers why the first version never actually evolved — it rebuilt the population from fresh random networks every generation, so 0 of 20 evolved brains survived — and the selection-on/selection-off experiment that shows selection, not luck, is what improves foraging.

**[brettadams0.github.io](https://github.com/brettadams0/brettadams0.github.io)** — `Jekyll` `CSS` `GitHub Actions`
My portfolio. One page plus an [MCP case study](https://brettadams0.github.io/mcp/), one hand-written stylesheet with no theme gem, dark only, and four live in-browser demos. CI builds it with the same action GitHub Pages uses, fails if any internal link or asset doesn't resolve, and holds every page to a weight budget measured in a real browser.

---

### Currently

- Data work at Geotab — production BigQuery SQL and Airflow DAGs for the SalesOps pipelines.
- Building MCP servers so Claude Code can act on real systems instead of just describing them, and tooling to keep them honest once they exist.

### Tools I actually reach for

`Python` · `JavaScript / TypeScript` · `Java` · `C / C++` · `SQL` · `BigQuery` · `Airflow`
`Node.js` · `Next.js` · `Flask` · `PHP` · `MySQL` · `PostgreSQL` · `SQLite`
`Git` · `Docker` · `Linux` · `Bash` · `pandas`
