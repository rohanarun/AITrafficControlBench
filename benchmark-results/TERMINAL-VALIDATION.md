# Live terminal benchmark validation

These are server-executed script runs, not standalone model evaluations. Controller identities are self-reported. Replay fixtures include every action and independently verify against the recorded configuration and engine behavior.

## v0.3.0 generator regression

[Server replay](https://getsupers.com/airspace/api/results/17349e59-321f-4e12-87d7-db6dd60c26e8), fixture `terminal-v030-regression.json`.

The run returned 17 safe landings, 33 safe departures, 16 separation-loss pairs and no collisions. It failed qualification. Fifteen separation-loss events began exactly when new aircraft spawned into occupied holding cells; one was a controller spacing failure. This run is not a valid measure of controller quality because the initial-condition generator could introduce conflicts before any response was possible.

v0.3.1 fixes allocation generically by using additional horizontal cells when altitude layers are exhausted. It does not exempt any aircraft from safety checks. Tests cover all official seeds with idle holding and verify no uncommanded spawn conflicts. The archived configuration preserves v0.3.0 replay behavior.

## v0.3.1 first controller attempt

[Server replay](https://getsupers.com/airspace/api/results/07fcfe82-e503-4f8a-badf-047de798f2fc), fixture `terminal-v031-first-attempt.json`.

The same observation-only forecast policy returned 19 safe landings and 60 safe departures, with one separation-loss pair and no collisions/runway incidents. It failed qualification. The server reported 318.328 seconds wall time and null all-flight simulated completion time. Unserved demand remained substantial.

The failure involved two arrivals compressing below the required spacing on final. A forecast using constant observed wind and narrow margins did not sufficiently cover evolving wind, observation age and execution uncertainty. The controller prompt now explicitly requires uncertainty budgets. The second script policy adds 2 NM horizontal/wake and 200 ft vertical forecasting margins; those do not change benchmark safety rules. This is a conservative baseline improvement, not proof that its uncertainty treatment is sufficient in general.

## v0.3.1 second controller attempt

[Server replay](https://getsupers.com/airspace/api/results/52fa370a-b343-453b-8aca-50e1c74c09d3), fixture `terminal-v031-second-attempt.json`.

Wider trajectory margins returned 13 safe landings and 65 safe departures, with zero separation losses/collisions but one runway incident. It failed qualification. The departure issued at simulated second 950 executed at 955; the last touchdown was at 837, so the configured 120-second interval had not yet elapsed. Forecasting only the maximum pilot delay of eight seconds had incorrectly made the release appear safe.

The next controller policy requires runway/wake availability at issuance and forecasts both minimum and maximum pilot response times. This changes the controller prompt and script, not the simulator, safety gate or benchmark version.

## v0.3.1 qualifying third attempt

[Server replay](https://getsupers.com/airspace/api/results/1968e9e2-1409-4304-ae55-56593fe257b0), fixture `terminal-v031-baseline.json`.

The third controller returned 13 safe landings and 64 safe departures, zero separation losses/collisions/runway incidents, and passed the current safety gate. Completion was only 30.56%; 100 flights exhausted modeled fuel and 75 remained unfinished. These outcomes do not fail the present gate but are major operational failures, not safe outcomes. This is a low-throughput benchmark baseline, not evidence of operational readiness.

The server measured 275.886 seconds wall time and 1837.73 simulated seconds mean completion time for served flights. All-flight completion time is null because not every flight completed safely. The exact public replay independently verifies; the controller uses no runtime model or hidden future arrivals. The script and prompt record lessons about forecast uncertainty and earliest/latest pilot timing.
