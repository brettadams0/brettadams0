## Brett Adams

Fourth-year Computer Science (Software Engineering) at the **University of Windsor**, currently a **Data Analyst Intern at Geotab** working in BigQuery, Airflow, and SQL.

I like building the unglamorous layer — auth flows, data plumbing, the tool that removes a manual step — and writing down *why* it works the way it does.

[Portfolio](https://brettadams0.github.io/) · [Blog](https://brettadams0.github.io/blog/) · [LinkedIn](https://www.linkedin.com/in/bretta/) · [Résumé](https://brettadams0.github.io/assets/resume/Resume_BrettAdams.pdf)

---

### Selected work

**[mcp-surface](https://github.com/brettadams0/mcp-surface)** — `TypeScript` `MCP` `CLI` · [on npm](https://www.npmjs.com/package/mcp-surface)
A broken MCP server usually doesn't look broken. It starts, it completes the handshake, the client lists it as **Connected** — and the model never calls anything, because the tool surface came back empty, a schema didn't compile, or a `required` field names a property that isn't there. Nothing errors; you just get worse answers. `mcp-surface` connects the way a real client does, reports the surface it actually sees, validates every schema, and fails CI when that surface changes without you meaning it to. Ships as a CLI and a GitHub Action.

**[google-workspace-mcp](https://github.com/brettadams0/google-workspace-mcp)** — `Node` `OAuth 2.0` `MCP`
An MCP server that gives Claude Code write access to Gmail, Calendar, Drive, Sheets, and YouTube. 23 tools over 5 Google APIs, running on an OAuth client I own rather than a hosted connector. It requests *only* write scopes — `gmail.readonly` and `drive.readonly` are Google "Restricted" scopes that would drag a single-user tool into a paid CASA security audit, so reading is left to the connectors that already do it well. Tested in CI without credentials or network.

**[brettadams0.github.io](https://github.com/brettadams0/brettadams0.github.io)** — `Jekyll` `SCSS` `Web Perf`
My portfolio and blog. The interesting part is the loading strategy: fonts use `display=optional` rather than `swap` because swapping after layout measured ~0.08 CLS, and the scroll-animation CSS is gated behind a `no-js` class so a blocked script can't leave the page permanently invisible.

**[TechNest](https://github.com/brettadams0/TechNest)** — `PHP` `MySQL`
A full e-commerce application — catalog, cart, checkout, order management, switchable themes, and a separate admin panel — with a real schema, seed data, and written admin/end-user/installation guides.

**Four more MCP servers**, same shape, different auth models — which is most of what makes them interesting:
[`reddit-mcp`](https://github.com/brettadams0/reddit-mcp) (OAuth2, and the only one that can post publicly as you) ·
[`yahoo-fantasy-mcp`](https://github.com/brettadams0/yahoo-fantasy-mcp) (OAuth2 with rotating refresh tokens and an out-of-band consent flow) ·
[`supercell-mcp`](https://github.com/brettadams0/supercell-mcp) (three game APIs behind one server; keys are bound to your public IP, which fails as a confusing 403) ·
[`chesscom-mcp`](https://github.com/brettadams0/chesscom-mcp) (no auth at all). All five run tests in CI without credentials or network.

Writing five of these is where `mcp-surface` came from: the same failures kept recurring, none of them announced themselves, and every one was visible in the tool surface if you actually looked at it.

**[neuronet-arena](https://github.com/brettadams0/neuronet-arena)** — `Python` `Genetic Algorithms`
Agents driven by small hand-rolled neural networks compete in a graph-based arena and evolve across generations. No ML framework: the network and the genetic algorithm are both written from scratch.

---

### Currently

- Analytics work at Geotab — BigQuery, Airflow DAGs, SQL over vehicle telematics data.
- Building MCP servers so Claude Code can act on real systems instead of just describing them, and tooling to keep them honest once they exist.
- Writing up what breaks, at [brettadams0.github.io/blog](https://brettadams0.github.io/blog/).

### Tools I actually reach for

`Python` · `JavaScript / TypeScript` · `Java` · `C / C++` · `SQL` · `BigQuery` · `Airflow`
`Node.js` · `Next.js` · `Flask` · `PHP` · `MySQL` · `PostgreSQL` · `SQLite`
`Git` · `Docker` · `Linux` · `Bash` · `pandas`
