# Brett Adams

I build backend services, data pipelines and developer tools. I’m a Computer Science student in the Software Engineering program at the University of Windsor, graduating in 2027. I’m a Data Analyst Intern on Geotab’s Global Data Operations team, where I work with BigQuery and Airflow. I’m based in Vineland, Ontario.

[Portfolio](https://brettadams0.github.io/) · [Résumé](https://brettadams0.github.io/assets/resume/Resume_BrettAdams.pdf) · [LinkedIn](https://www.linkedin.com/in/bretta/)

## Selected work

**Signal Lab** lets you investigate historical transit incidents, changes in retail revenue and a synthetic retention dataset. For one unusually strong Tuesday, you can reproduce the **£81,948.30** difference between recorded net revenue and its weekday baseline using the published aggregates and a short Python verifier. [Reproduce the calculation](https://brettadams0.github.io/projects/signal-lab/investigate/?alert=c646f48c31360b392784.weekday-1.median.net.2011-09-20) · [Explore the workspaces](https://brettadams0.github.io/signal-lab/)

**mcp-surface** checks what an MCP server actually advertises to clients. I built it after working on five servers that could complete a handshake even when a tool’s schema was unusable. A Zod upgrade passed the Google Workspace server’s unit tests and changed all 23 tool schemas. The CLI and GitHub Action can catch that difference before release. Try switching the playground from Healthy to Broken to see the findings and CI verdict. [Playground](https://brettadams0.github.io/mcp-surface/) · [Source and upgrade evidence](https://github.com/brettadams0/mcp-surface) · [MCP case study](https://brettadams0.github.io/mcp/)

**Border Waits** collects official Canadian and US estimates for land crossings. A report marked “At Noon EDT” and a reading with an ambiguous time zone need different handling before anyone compares them. My Python, dbt and DuckDB pipeline keeps the last good export available if a run fails. The dashboard shows how old a reading is and lets you query the published history in your browser. [Dashboard and SQL](https://brettadams0.github.io/border-waits/) · [Source and data definitions](https://github.com/brettadams0/border-waits-pipeline)

**Sift** is an Android photo triage and grading app that works on device without network permission. An export and a decision to trash an original are separate operations. The release checks run both data and app tests on Android API 30 and 35. [Source, APK and known limitations](https://github.com/brettadams0/sift) · [Android test run](https://github.com/brettadams0/sift/actions/runs/44841557129)

## More engineering work

- **Neuronet Arena** evolves small neural networks in Python and replays seeded runs in JavaScript. The selection experiment compares generations with selection enabled and disabled. [Live simulation](https://brettadams0.github.io/neuronet-arena/) · [Experiment and source](https://github.com/brettadams0/neuronet-arena)
- **MazeFinder** uses breadth-first search to guide a C++ genetic algorithm. The browser runs the solver in one Web Worker. The native CLI scores routes on a thread pool. [Step through a maze](https://brettadams0.github.io/mazefinder/) · [C++ source](https://github.com/brettadams0/MazeFinder-GeneticAlgorithm)
- **PromptPal** turns typed template fields into a reusable prompt, reports parser errors by line and column, and exports the result as text or an API call. [Try the builder](https://prompt-pal-gules.vercel.app) · [Source](https://github.com/brettadams0/PromptPal)
- **TechNest** is a PHP storefront with a transactional checkout. A conditional inventory update handles two customers trying to buy the last unit. [Checkout implementation and tests](https://github.com/brettadams0/TechNest)
- **MCP integrations** use shared contract checks across five servers. Google Workspace uses a self-owned OAuth client. Reddit handles rejected writes, while Chess.com, Supercell and Yahoo Fantasy expose read-only tools. [Google Workspace](https://github.com/brettadams0/google-workspace-mcp) · [Reddit](https://github.com/brettadams0/reddit-mcp) · [Chess.com](https://github.com/brettadams0/chesscom-mcp) · [Supercell](https://github.com/brettadams0/supercell-mcp) · [Yahoo Fantasy](https://github.com/brettadams0/yahoo-fantasy-mcp)
