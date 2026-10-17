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

**[reddit-mcp](https://github.com/brettadams0/reddit-mcp)** — `Node` `OAuth 2.0` `MCP`
12 tools that read, post, comment, vote, and message as your Reddit account. Reddit answers a rejected post with HTTP 200 and the reasons tucked into the body, and quietly ignores an id of the wrong type, so the server turns both into real errors rather than letting the model announce a post that never went up. Subreddit names and ids are validated before they reach a URL, because `../api/v1/me` would otherwise resolve to a different endpoint with your token attached.

Writing MCP servers is where `mcp-surface` came from: the same failures kept recurring, none of them announced themselves, and every one was visible in the tool surface if you actually looked at it. The [case study](https://brettadams0.github.io/mcp/) covers how the three fit together and what a security review of the servers turned up.

**[TechNest](https://github.com/brettadams0/TechNest)** — `PHP` `MySQL`
A full e-commerce application — catalog, cart, checkout, order management, switchable themes, and a separate admin panel — with a real schema, seed data, and written admin/end-user/installation guides.

**[neuronet-arena](https://github.com/brettadams0/neuronet-arena)** — `Python` `Genetic Algorithms`
Agents driven by small hand-rolled neural networks compete in a graph-based arena and evolve across generations. No ML framework: the network and the genetic algorithm are both written from scratch.

**[brettadams0.github.io](https://github.com/brettadams0/brettadams0.github.io)** — `Jekyll` `CSS` `GitHub Actions`
My portfolio. One page, one stylesheet, light and dark themes that follow the system setting, and no JavaScript apart from analytics. CI builds it with the same action GitHub Pages uses and fails if any internal link or asset doesn't resolve.

---

### Currently

- Data work at Geotab — production BigQuery SQL and Airflow DAGs for the SalesOps pipelines.
- Building MCP servers so Claude Code can act on real systems instead of just describing them, and tooling to keep them honest once they exist.

### Tools I actually reach for

`Python` · `JavaScript / TypeScript` · `Java` · `C / C++` · `SQL` · `BigQuery` · `Airflow`
`Node.js` · `Next.js` · `Flask` · `PHP` · `MySQL` · `PostgreSQL` · `SQLite`
`Git` · `Docker` · `Linux` · `Bash` · `pandas`
