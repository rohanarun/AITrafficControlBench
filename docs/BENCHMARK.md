# Benchmark contract v0.3.0: SAN mixed traffic

There is one hard challenge (API identifier 6), with three fixed seeds, 60 arrivals and 24 departures per scenario, 90 simulated minutes each. Arrival demand is distributed over approximately one hour, with 12 airborne arrivals and three queued departures initially visible. The workload exceeds what a simple one-at-a-time controller can efficiently serve. Aircraft count is a benchmark demand setting, not a claim about safe staffing or actual SAN operations.

## Fidelity and provenance

The local east/north NM coordinate frame uses KSAN runway09's west physical end. Runway dimensions, bearing and displaced threshold derive from the public-domain OurAirports runway record. The FAA ILS Y RWY09 chart, cycle2611, provides the3.10-degree glide path,55ft threshold crossing reference,2000ft intercept and5000ft missed-approach altitude references. Source URLs, retrieved date and SHA256 hashes are in config/benchmark.json. The runway is oriented106 degrees TRUE; the published95-degree MAGNETIC approach course must not be substituted for a true-heading command.

The route to the intercept point, holding fixes and runway-heading departure are synthetic. This release does not encode the entire published ILS, missed approach, SID, terrain, obstructions, adjacent airspace, taxi network or other airports. The benchmark autopilot remains a simplified pilot-response model, including below the chart's autopilot coupling restriction; it is not a procedure compliance demonstration.

Representative medium/heavy jet performance profiles are explicit benchmark assumptions, not certified A 320/B 737/etc. envelopes. They use bank-limited heading change g*tan(bank)/TAS, gradual IAS acceleration, bounded vertical rate and vertical acceleration, a simplified exponential atmosphere for IAS-to-TAS conversion, evolving wind by altitude, takeoff roll and landing occupancy. Profile fuel rates are approximate and not validated against real flight recordings. No BlueSky/OpenAP code or data is incorporated. Further realism requires calibrated performance, full navigation procedures, terrain and expert validation.

Pilot execution is delayed 3–8 seconds. Surveillance updates every 5 seconds with 3 seconds latency, position quantization and altitude quantization. Observation trackTime is explicit. Ground-truth position history, future arrivals and exact pending execution times are not exposed. Controller commands/targets and phase transitions remain observable. No speech interpretation, stochastic readback errors, aircraft sensor failures or real-world weather feed is claimed.

## Safety

One-second segments use swept collision and separation intersection tests. Default airborne protection is3NM horizontally or1000ft vertically, with increased heavy-leader following separation. The wake model is a simplified conservative envelope plus threshold checks, not complete FAA consolidated wake categorization or all contextual exceptions. Source reference: https://www.faa.gov/Air_traffic/publications/atpubs/atc_html/chap5_section_5.html . Collision geometry is a configurable proxy, not an aircraft mesh model.

Approach capture requires geometry, altitude and heading conditions. Unstable approaches or blocked runways trigger pilot go-arounds; these can still conflict with other aircraft. Aircraft do not instantaneously snap to a runway or assigned altitude. Takeoff releases on closed/occupied runways or during the modeled departure interval are runway incidents. Landing credit follows runway vacation, not just a threshold crossing. Departures complete after reaching the sector boundary at sufficient altitude. No ground taxi conflict simulation is implemented.

A qualifying run has zero separation losses, collisions, runway incidents and invalid-action errors. An aircraft involved in a violation permanently loses safe-completion credit. Fuel exhaustion, escaping the sector or remaining unfinished yields no completion credit and retains the time penalty. Qualification is separate from throughput: an idle controller might qualify while scoring zero. Display zero-throughput runs honestly; they do not establish useful capability.

## Ranking and efficiency

Compare only the same version/challenge. The ordered ranking is:
1. Qualifying safety gate.
2. More safe landings.
3. More safe departures.
4. Lower timeToCompleteSeconds if every flight safely completes.
5. Lower unservedTimeSeconds.
6. Lower modeled fuelUsedKg.

No weighted trade can compensate for a safety violation. Safe landings remain the primary benchmark objective; departing every aircraft while landing none cannot beat a safe arrival controller.

For each flight, unservedTimeSeconds adds spawn-to-safe-completion time; until safe completion it adds spawn-to-current-time. At the final horizon every abandoned, crashed, unsafe or fuel-exhausted flight is therefore charged through the horizon. This prevents reducing the time metric by destroying or abandoning aircraft. It measures time in system, NOT delay relative to a feasible optimum.

timeToCompleteSeconds is the latest safe completion time only if every scheduled flight safely completes; otherwise null. Across scenarios it is summed only if all scenarios are complete. Continuing the episode to its fixed horizon does not change an already achieved completion time. The server also publishes completion percentage, safe landings/hour, mean time per safely completed flight, distance, modeled fuel, holding/airborne seconds, go-arounds and aircraft-seconds of separation violations. Mean completed-flight time alone is not a ranking metric because it excludes unserved demand.

wallClockSeconds is elapsed real time from session creation through finalization, including computation, network and user pauses. It is outside the replay-verified score and is diagnostic only. There is no standardized compute budget or decision deadline, so it is not evidence one underlying model reasons faster than another.

## Reproducibility and limitations

Server-executed hosted results require all three scenarios and final next. Practice never enters the board. The local full suite now has3scenarios (one challenge). Replay verification reconstructs observations/actions and checks exact scores and configuration fingerprints. v0.1/v0.2 use src/legacy-engine.js and frozen configurations; never reinterpret their results under this engine.

Names are self-reported. Include actual model ID or script/no runtime model. No model provenance authentication, unseen-seed evaluation, model cost normalization or controller-reviewed validation exists yet. The public fixed seeds permit overfitting. Provider comparison should distinguish scripts, prompted models and tool-assisted model controllers.

Validation status: automated behavioral/regression tests and repeatable scenarios, not operational or training certification. Next priorities are real performance calibration, complete procedures/terrain, recorded-traffic replay validation, private evaluation seeds with fixed compute budgets, and review by experienced controllers. A test passing is not proof of FAA compliance.
