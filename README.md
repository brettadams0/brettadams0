## Brett Adams

Fourth-year Computer Science (Software Engineering) at the **University of Windsor**, currently a **Data Analyst Intern at Geotab** working in BigQuery, Airflow, and SQL.

I like building the unglamorous layer — auth flows, data plumbing, the tool that removes a manual step — and writing down *why* it works the way it does.

[Portfolio](https://brettadams0.github.io/) · [Blog](https://brettadams0.github.io/blog/) · [LinkedIn](https://www.linkedin.com/in/bretta/) · [Résumé](https://brettadams0.github.io/assets/resume/Resume_BrettAdams.pdf)

---

### Selected work

**[google-workspace-mcp](https://github.com/brettadams0/google-workspace-mcp)** — `Node` `OAuth 2.0` `MCP`
An MCP server that gives Claude Code write access to Gmail, Calendar, Drive, Sheets, and YouTube. 23 tools over 5 Google APIs, running on an OAuth client I own rather than a hosted connector. It requests *only* write scopes — `gmail.readonly` and `drive.readonly` are Google "Restricted" scopes that would drag a single-user tool into a paid CASA security audit, so reading is left to the connectors that already do it well. Tested in CI without credentials or network.

**[brettadams0.github.io](https://github.com/brettadams0/brettadams0.github.io)** — `Jekyll` `SCSS` `Web Perf`
My portfolio and blog. The interesting part is the loading strategy: fonts use `display=optional` rather than `swap` because swapping after layout measured ~0.08 CLS, and the scroll-animation CSS is gated behind a `no-js` class so a blocked script can't leave the page permanently invisible.

**[TechNest](https://github.com/brettadams0/TechNest)** — `PHP` `MySQL`
A full e-commerce application — catalog, cart, checkout, order management, switchable themes, and a separate admin panel — with a real schema, seed data, and written admin/end-user/installation guides.

**[neuronet-arena](https://github.com/brettadams0/neuronet-arena)** — `Python` `Genetic Algorithms`
Agents driven by small hand-rolled neural networks compete in a graph-based arena and evolve across generations. No ML framework: the network and the genetic algorithm are both written from scratch.

**[PromptPal](https://github.com/brettadams0/PromptPal)** — `Next.js` `TypeScript` `Tailwind`
A prompt-composition tool for LLMs, built on the App Router with a typed component library.

---

### Currently

- Analytics work at Geotab — BigQuery, Airflow DAGs, SQL over vehicle telematics data.
- Building MCP servers so Claude Code can act on real systems instead of just describing them.
- Writing up what breaks, at [brettadams0.github.io/blog](https://brettadams0.github.io/blog/).

### Tools I actually reach for

`Python` · `JavaScript / TypeScript` · `Java` · `C / C++` · `SQL` · `BigQuery` · `Airflow`
`Node.js` · `Next.js` · `Flask` · `PHP` · `MySQL` · `PostgreSQL` · `SQLite`
`Git` · `Docker` · `Linux` · `Bash` · `pandas`
