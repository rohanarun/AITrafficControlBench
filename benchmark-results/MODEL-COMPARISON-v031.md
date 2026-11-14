# Model-built controller comparison — v0.3.1

Each requested model independently built and ran one script-assisted controller for all three official scenarios. Per-action decisions were scripted; these are not per-action language-model inference evaluations. Both had the same benchmark, observation API, engine mechanics and baseline reference available. Policies used current observations and forecasts, not future arrival manifests or replay action schedules.

| Model that built controller | Safe landings | Safe departures | Completion | Fuel exhausted | Unfinished | Session wall time |
|---|---:|---:|---:|---:|---:|---:|
| GPT-6.1 Sol | 45 | 27 | 28.57% | 75 | 105 | 596.582 s |
| GPT-6 Astra | 44 | 22 | 26.19% | 78 | 108 | 627.061 s |

Both runs returned zero separation losses, collisions, runway incidents and agent errors, and passed the current gate. Both have null all-flight completion time. Fuel exhaustion is a major operational failure even though this benchmark's gate permits it. The capacity audit proves all-flight completion infeasible in this version; these results measure throughput under overload.

Sol ranks ahead on safe landings. Both improved landings over the 13-landing baseline, but completed fewer total flights than its 77 safe arrivals plus departures. One attempt per model does not establish general model superiority. Wall time includes local scripted forecasting, shared CPU, network and idle time; model development time/token budgets were not standardized, and wall time is not model inference latency.

- GPT-6.1 Sol (`gpt-6.1-sol`): [public replay](https://getsupers.com/airspace/api/results/ab8cef34-5c4e-45bc-8127-0a90ba0545d3), [source](../examples/model-comparison/sol61/controller.mjs). Distance/fuel-slack admission, both pilot-delay bounds, uncertainty margins and adaptive decision cadence. Unserved time: 795622 seconds; mean completed-flight time: 2207.11 seconds.
- GPT-6 Astra (`gpt-6-astra`): [public replay](https://getsupers.com/airspace/api/results/917b9e63-99a8-4641-87a1-7569bf6ba09e), [source](../examples/model-comparison/astra6/controller.mjs). Faster transit with early braking, observed wind shear and feasibility/fuel-slack admission. Unserved time: 812289 seconds; mean completed-flight time: 2233.32 seconds.

The archived controller sources are exact executed policies. For a fresh run, copy the chosen controller into `.local/model-comparison/<name>/controller.mjs` within an SSD checkout and run it there; its relative engine import expects this depth. It creates a live competition and writes private session credentials locally. Never publish generated credentials or session responses. Public replay fixtures here contain server-returned scores and all actions; both independently passed CLI replay verification.
