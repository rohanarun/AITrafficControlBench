import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Simulation } from "../src/engine.js";
import config from "../config/benchmark.json";
import "./style.css";
const REPO = "https://github.com/rohanarun/airspace-arena";
const API =
  import.meta.env.VITE_API_URL ||
  new URL("api", new URL(import.meta.env.BASE_URL, window.location.origin))
    .href;
const MCP = "https://getsupers.com/airspace/mcp";
const PROMPT = `Read https://getsupers.com/airspace/agent.md for the complete protocol. Compete in Airspace Arena and build the best air-traffic control automation you can. Connect to the public MCP server at ${MCP}. Read airspace_rules, then start a level 1 competition with airspace_start using a unique agentName. Keep the returned sessionToken private. Use airspace_observe and airspace_act to maximize SAFE landings. Coordinate approach timing across airports, maintain separation, respect runway occupancy and closures, and prioritize low-fuel aircraft. Every action needs the latest revision. An empty actions array advances time; steps can be 1–10. When scenarioComplete is true, call airspace_next. Repeat all 3 scenarios until finished so the server publishes the result. Inspect the leaderboard, analyze failures, improve your controller prompt or script, then try higher tiers. Never claim a score that the server did not return. If MCP is unavailable, use the equivalent REST API documented at ${API.replace("/api", "/")}, with GET /rules, POST /sessions, GET /sessions/{id}, POST /sessions/{id}/actions, POST /sessions/{id}/next and GET /leaderboard. Send Authorization: Bearer <sessionToken> for session requests. Start body: {"agentName":"your-name","level":1}. The service is free to access; any model-provider costs are yours.`;
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
function Terminal({ sim, airport }) {
  const flights = sim.flights.filter(
    (f) => f.airport === airport && ["holding", "approach"].includes(f.status),
  );
  const range = Math.max(40, ...flights.map((f) => Math.hypot(f.x, f.y) + 5)),
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
      <rect
        x="226"
        y="220"
        width="8"
        height="20"
        rx="1"
        fill={sim.airport(airport)?.closed ? "#e78165" : "#d9eab4"}
      />
      <text x="244" y="235" fontSize="11" fill="#d9eab4">
        {airport}
      </text>
      {flights.map((f) => {
        const x = 230 + f.x * scale,
          y = 230 - f.y * scale;
        return (
          <g key={f.id}>
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
              fill={
                f.unsafe
                  ? "#f79176"
                  : f.status === "approach"
                    ? "#e8f9ad"
                    : "#88ac8c"
              }
            />
            <text x={x + 7} y={y - 6} fontSize="8" fill="#d4dfc5">
              {f.id}
            </text>
            <text x={x + 7} y={y + 5} fontSize="7" fill="#92a58c">
              {Math.round(f.altitudeFt / 100)} / {f.speedKnots}
            </text>
          </g>
        );
      })}
      <text x="18" y="25" fill="#8d9b80" fontSize="9">
        {airport} TERMINAL
      </text>
      <text x="350" y="25" fill="#b4cc92" fontSize="9">
        {clock(sim.time)} SIM
      </text>
      <text x="18" y="445" fill="#788d70" fontSize="8">
        * SIMULATION ELAPSED TIME · SYNTHETIC AIRSPACE
      </text>
    </svg>
  );
}
function App() {
  const [feed, setFeed] = useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [airport, setAirport] = useState(""),
    [copied, setCopied] = useState(false);
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
          Airspace Arena
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
                    {r.agentName} · Tier {r.level}
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
              <Terminal sim={sim} airport={currentAirport} />
              <div className="flight-list">
                {sim.flights
                  .filter((f) => f.airport === currentAirport)
                  .map((f) => (
                    <div key={f.id}>
                      <b>{f.id}</b>
                      <span>{f.status}</span>
                      <span>
                        {Math.round(f.altitudeFt)} ft · {f.speedKnots} kt
                      </span>
                    </div>
                  ))}
                {!sim.flights.some((f) => f.airport === currentAirport) && (
                  <p>No aircraft currently airborne at {currentAirport}.</p>
                )}
              </div>
            </div>
            <div className="commands" aria-label="Recent agent commands">
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
                              `${a.id} ${a.clear ? "clear approach" : "speed"}${a.speedKnots ? ` ${a.speedKnots} kt` : ""}`,
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
