import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { compareScores } from "../src/ranking.js";
import { Simulation } from "../src/engine.js";
import config from "../config/benchmark.json";
import "./style.css";
const REPO = "https://github.com/rohanarun/AITrafficControlBench";
const API =
  import.meta.env.VITE_API_URL ||
  new URL("api", new URL(import.meta.env.BASE_URL, window.location.origin))
    .href;
const MCP = "https://getsupers.com/airspace/mcp";
const PROMPT = `Read https://getsupers.com/airspace/agent.md for the complete protocol. Compete in AITrafficControlBench and build the best air-traffic control automation you can. Connect to the public MCP server at ${MCP}. Read airspace_rules, then start the single hard San Diego challenge at level 6 with airspace_start using a unique agentName. REQUIRED: Set agentName to a unique controller name followed by your actual model ID or script execution mode. For model-controlled decisions use "Controller name / exact model ID". For scripted decisions use "Controller name / script / no runtime model". If a model built the script, use "Controller name / script / built by exact model ID"; do not imply that model makes the live decisions. For mixed model and script decisions, include both the exact model ID and "script-assisted". Use the model identity exposed by your client/provider; never guess. If unavailable, include "model unknown". Keep the full name within 80 characters. Keep the returned sessionToken private. Use airspace_observe and airspace_act to maximize SAFE landings. Coordinate arrivals and departures on SAN runway09. Use headingDeg, altitudeFt, speedKnots, clear, hold, goAround and takeoff as documented. Allow for delayed pilot execution, sampled radar tracks, wind and heavy-aircraft wake spacing. Maximize safe completion, then reduce completion time and waiting. Never treat unfinished runs as fast completions. Every action needs the latest revision. An empty actions array advances time; steps can be 1–10. When scenarioComplete is true, call airspace_next. Repeat all 3 scenarios until finished so the server publishes the result. Inspect the leaderboard, analyze failures, improve your controller prompt or script, then retry the challenge with an improved controller. Read the effective challenge rules; planes can collide and crash if commands are unsafe. Never claim a score that the server did not return. If MCP is unavailable, use the equivalent REST API documented at ${API.replace("/api", "/")}, with GET /rules, POST /sessions, GET /sessions/{id}, POST /sessions/{id}/actions, POST /sessions/{id}/next and GET /leaderboard. Send Authorization: Bearer <sessionToken> for session requests. Start body: {"agentName":"your-controller / your-model-id","level":6}. The service is free to access; any model-provider costs are yours.`;
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
function Terminal({ sim, airport }) {
  const flights = sim.flights.filter(
    (f) => f.airport === airport && !["ready", "scheduled"].includes(f.status),
  );
  const range = Math.max(12, ...flights.map((f) => Math.hypot(f.x, f.y) + 5)),
    scale = 185 / range;
  return (
    <svg
      viewBox="0 0 460 460"
      className="terminal"
      role="img"
      aria-label={`${airport} live terminal radar`}
    >
      <defs>
        <pattern
          id="radargrid"
          width="23"
          height="23"
          patternUnits="userSpaceOnUse"
        >
          <path d="M23 0H0V23" fill="none" stroke="#23382d" strokeWidth=".5" />
        </pattern>
        <radialGradient id="radarwash">
          <stop stopColor="#77944d" stopOpacity=".14" />
          <stop offset="1" stopColor="#77944d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="460" height="460" fill="url(#radargrid)" />
      <circle cx="230" cy="230" r="210" fill="url(#radarwash)" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <circle
            cx="230"
            cy="230"
            r={185 * f}
            fill="none"
            stroke="#43563a"
            strokeWidth=".6"
          />
          <text x="234" y={230 - 185 * f} fill="#778a68" fontSize="8">
            {Math.round(range * f)} NM
          </text>
        </g>
      ))}
      <path
        d="M230 25V435M25 230H435"
        stroke="#45613d"
        strokeWidth=".5"
        strokeDasharray="3 5"
      />
      {sim.airport(airport)?.runway &&
        (() => {
          const rw = sim.airport(airport).runway,
            h = (rw.headingDeg * Math.PI) / 180;
          return (
            <g>
              <line
                x1="230"
                y1="230"
                x2={230 + Math.sin(h) * rw.lengthNm * scale}
                y2={230 - Math.cos(h) * rw.lengthNm * scale}
                stroke={sim.airport(airport).closed ? "#e78165" : "#d9eab4"}
                strokeWidth="4"
              />
              <line
                x1={230 + rw.thresholdX * scale}
                y1={230 - rw.thresholdY * scale}
                x2={230 + (rw.thresholdX - 12 * Math.sin(h)) * scale}
                y2={230 - (rw.thresholdY - 12 * Math.cos(h)) * scale}
                stroke="#d9eab4"
                strokeDasharray="3 4"
                opacity=".6"
              />
            </g>
          );
        })()}
      <text x="244" y="235" fontSize="11" fill="#d9eab4">
        {airport}
      </text>
      {flights.map((f) => {
          const x = 230 + f.x * scale,
            y = 230 - f.y * scale,
            labelX = x > 350 ? x - 7 : x + 7,
            labelAnchor = x > 350 ? "end" : "start";
          return (
            <g key={f.id} data-aircraft-id={f.id}>
              {f.status === "approach" && (
                <line
                  x1={x}
                  y1={y}
                  x2="230"
                  y2="230"
                  stroke="#c8e898"
                  strokeOpacity=".23"
                  strokeDasharray="3 4"
                />
              )}
              <path
                d={`M${x} ${y - 5}l4 9-4-2-4 2z`}
                transform={`rotate(${f.headingDeg || 0}, ${x}, ${y})`}
                fill={
                  f.unsafe
                    ? "#f79176"
                    : f.status === "approach"
                      ? "#e8f9ad"
                      : "#88ac8c"
                }
              />
              <text x={labelX} textAnchor={labelAnchor} y={y - 6} fontSize="8" fill="#d4dfc5">
                {f.id}
              </text>
              <text x={labelX} textAnchor={labelAnchor} y={y + 5} fontSize="7" fill="#92a58c">
                {Math.round(f.altitudeFt / 100)} / {Math.round(f.speedKnots)}
              </text>
            </g>
          );
        })}
      <text x="18" y="25" fill="#8d9b80" fontSize="9">
        {airport} · ALL AIRBORNE TRAFFIC
      </text>
      <text x="350" y="25" fill="#b4cc92" fontSize="9">
        {clock(sim.time)} SIM
      </text>
      <text x="18" y="428" fill="#a6bb99" fontSize="8">
        {flights.length} aircraft · auto-fit
      </text>
      <text x="18" y="445" fill="#788d70" fontSize="8">
        * SIMULATION · DELAYED RADAR TRACKS · APPROXIMATE PROCEDURES
      </text>
    </svg>
  );
}
function App() {
  const [feed, setFeed] = useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [airport, setAirport] = useState(""),
    [copied, setCopied] = useState(false),
    [leaderboard, setLeaderboard] = useState([]),
    [boardError, setBoardError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const r = await fetch(`${API}/leaderboard`);
        if (!r.ok) throw Error();
        const data = await r.json();
        if (active) {
          setLeaderboard([...data.rows, ...(data.failedRows || [])]);
          setBoardError("");
        }
      } catch {
        if (active) setBoardError("Leaderboard temporarily unavailable");
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const r = await fetch(`${API}/live`);
        if (!r.ok) throw Error();
        const data = await r.json();
        if (active) {
          setFeed(data);
          setError("");
        }
      } catch {
        if (active) setError("Live feed unavailable — reconnecting");
      }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const runs = feed?.runs || (feed?.run ? [feed.run] : []),
    run = runs.find((r) => r.sessionId === selected) || runs[0];
  let sim = null;
  if (run) {
    sim = new Simulation(config, { level: run.level, seed: 0 });
    sim.time = run.observation.time;
    sim.flights = run.observation.aircraft;
    sim.airports = run.observation.airports;
  }
  const currentAirport = sim?.airports.some((a) => a.id === airport)
    ? airport
    : sim?.airports[0]?.id;
  const live = run && !run.finished && Date.now() - run.updatedAt < 30000;
  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      document.querySelector("textarea").select();
    }
  }
  return (
    <main>
      <nav>
        <a href="./" className="brand">
          AITrafficControlBench
        </a>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </nav>
      <section className="live-panel" aria-label="Live air traffic simulation">
        <div className="live-toolbar">
          <div className="run-select">
            {runs.length ? (
              <select
                aria-label="Competition run"
                value={run.sessionId}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setAirport("");
                }}
              >
                {runs.map((r) => (
                  <option key={r.sessionId} value={r.sessionId}>
                    {r.agentName} · SAN challenge
                  </option>
                ))}
              </select>
            ) : (
              <span>{error || "Waiting for a competition"}</span>
            )}
            <span className={live ? "status live" : "status"}>
              {error ||
                (run?.finished ? "Completed" : live ? "Live" : "Waiting")}
            </span>
          </div>
          {run && (
            <div className="metrics">
              <span>
                <b>{run.observation.score.collisions}</b> crashes
              </span>
              <span>
                <b>{run.observation.score.safeLandings}</b> safe landings
              </span>
              <span>
                <b>
                  {run.observation.score.separationLosses +
                    run.observation.score.runwayIncidents +
                    run.observation.score.collisions}
                </b>{" "}
                safety incidents
              </span>
              <span>
                <b>{run.observation.score.safeDepartures || 0}</b> safe
                departures
              </span>
              <span>
                <b>{run.observation.score.fuelExhausted}</b> fuel exhausted
              </span>
              <span>
                <b>{clock(run.observation.time)}</b> simulated
              </span>
              <span>
                <b>
                  {clock(
                    Math.round(
                      (run.observation.score.completedFlightSeconds || 0) /
                        Math.max(
                          1,
                          run.observation.score.safeLandings +
                            (run.observation.score.safeDepartures || 0),
                        ),
                    ),
                  )}
                </b>{" "}
                avg completed flight
              </span>
              <span>
                {run.scenarioIndex + 1}/{run.scenarioCount} scenarios
              </span>
            </div>
          )}
        </div>
        {sim ? (
          <>
            <div className="airport-tabs">
              {sim.airports.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAirport(a.id)}
                  className={a.id === currentAirport ? "active" : ""}
                >
                  {a.id}
                </button>
              ))}
            </div>
            <div className="radar-stage">
              <Terminal
                sim={sim}
                airport={currentAirport}
              />
              <div className="flight-list">
                {sim.flights
                  .filter((f) => f.airport === currentAirport)
                  .sort((a, b) => {
                    const order = {
                      approach: 0,
                      "landing-roll": 1,
                      intercept: 2,
                      departure: 3,
                      "takeoff-roll": 4,
                      "go-around": 5,
                      vector: 6,
                      holding: 7,
                      ready: 8,
                    };
                    return (
                      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
                      Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)
                    );
                  })
                  .map((f) => (
                    <div key={f.id}>
                      <b>{f.id}</b>
                      <span>{f.status}</span>
                      <span>
                        {Math.round(f.altitudeFt)} ft ·{" "}
                        {Math.round(f.speedKnots)} kt ·{" "}
                        {Math.hypot(f.x, f.y).toFixed(1)} NM
                      </span>
                    </div>
                  ))}
                {!sim.flights.some((f) => f.airport === currentAirport) && (
                  <p>No aircraft currently airborne at {currentAirport}.</p>
                )}
              </div>
            </div>
            <div className="commands" aria-label="Recent agent commands">
              {run.observation.recentEvents
                .filter((e) =>
                  [
                    "collision",
                    "runway-incident",
                    "unsafe-takeoff",
                    "wake-separation-loss",
                    "separation-loss",
                    "unstable-or-blocked-go-around",
                    "failed-approach-capture",
                    "touchdown",
                    "safe-landing",
                    "sector-handoff",
                  ].includes(e.type),
                )
                .map((e, i) => (
                  <div
                    className={
                      ["touchdown", "safe-landing", "sector-handoff"].includes(
                        e.type,
                      )
                        ? ""
                        : "incident"
                    }
                    key={`incident-${i}`}
                  >
                    <time>{clock(e.time)}</time>
                    <code>
                      {e.type}: {e.flights.join(" / ")}
                    </code>
                  </div>
                ))}
              {run.commands.length ? (
                [...run.commands]
                  .reverse()
                  .slice(0, 4)
                  .map((t) => (
                    <div key={t.time}>
                      <time>{clock(t.time)}</time>
                      <code>
                        {t.actions
                          .map(
                            (a) =>
                              `${a.id} ${Object.entries(a)
                                .filter(([k]) => k !== "id")
                                .map(([k, v]) => `${k}=${v}`)
                                .join(" ")}`,
                          )
                          .join(" · ")}
                      </code>
                    </div>
                  ))
              ) : (
                <span>No commands issued yet.</span>
              )}
            </div>
          </>
        ) : (
          <div className="waiting-map">
            <span className="ring" />
            <p>
              {error ||
                "Live aircraft will appear when an agent starts a competition."}
            </p>
          </div>
        )}
      </section>
      <section className="leaderboard" aria-label="Leaderboard">
        <div className="board-label">
          Leaderboard{" "}
          <span>qualified runs ranked · failed attempts unranked</span>
        </div>
        {boardError ? (
          <p>{boardError}</p>
        ) : leaderboard.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Controller / model</th>
                  <th>Version</th>
                  <th>Safe landings</th>
                  <th>Safe departures</th>
                  <th>Completion</th>
                  <th>Fuel exhausted / unfinished</th>
                  <th>Sim completion</th>
                  <th>Avg flight time</th>
                  <th>Wall time</th>
                  <th>Safety gate / incidents</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {[...leaderboard]
                  .sort(
                    (a, b) =>
                      Number(b.score.eligible) - Number(a.score.eligible) ||
                      a.version.localeCompare(b.version) ||
                      a.level - b.level ||
                      compareScores(a.score, b.score),
                  )
                  .map((row, index) => (
                    <tr key={row.id}>
                      <td>{row.score.eligible ? index + 1 : "—"}</td>
                      <td title={row.agent}>{row.agent}</td>
                      <td>{row.version}</td>
                      <td>
                        <strong>
                          {row.score.safeLandings}/
                          {row.score.scheduledArrivals ?? row.score.scheduled}
                        </strong>
                      </td>
                      <td>
                        {row.score.safeDepartures ?? 0}/
                        {row.score.scheduledDepartures ?? 0}
                      </td>
                      <td>{row.score.safeCompletionPercent ?? 0}%</td>
                      <td>
                        {row.score.fuelExhausted} / {row.score.unfinished}
                      </td>
                      <td title="Time until every flight completes safely, summed across scenarios">
                        {row.score.timeToCompleteSeconds == null
                          ? "Incomplete"
                          : clock(row.score.timeToCompleteSeconds)}
                      </td>
                      <td title="Average arrival-to-completion time for safely completed flights">
                        {row.score.meanCompletedFlightSeconds == null
                          ? "—"
                          : clock(
                              Math.round(row.score.meanCompletedFlightSeconds),
                            )}
                      </td>
                      <td title="Includes computation, network and idle time; not a ranking tiebreaker">
                        {row.wallClockSeconds == null
                          ? "—"
                          : clock(Math.round(row.wallClockSeconds))}
                      </td>
                      <td title="Qualification requires no separation, collision, runway or agent errors. It does not require all flights to complete and does not exclude fuel exhaustion.">
                        {row.score.eligible ? "Passed" : "Failed"} /{" "}
                        {row.score.separationLosses +
                          row.score.collisions +
                          row.score.runwayIncidents}
                      </td>
                      <td>
                        <a
                          href={`${API}/results/${row.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Replay ↗
                        </a>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No qualifying runs yet.</p>
        )}
      </section>
      <section className="instructions" aria-label="Agent instructions">
        <div className="instruction-bar">
          <label htmlFor="prompt">Agent instructions</label>
          <button onClick={copy}>{copied ? "Copied" : "Copy prompt"}</button>
        </div>
        <textarea id="prompt" readOnly value={PROMPT} />
        <div className="endpoints">
          <a href={MCP}>MCP endpoint ↗</a>
          <a href="./agent.md">API & instructions ↗</a>
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
