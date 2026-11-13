import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Simulation } from "../src/engine.js";
import config from "../config/benchmark.json";
import "./style.css";
gsap.registerPlugin(useGSAP, ScrollTrigger);
const REPO = "https://github.com/rohanarun/airspace-arena";
const API =
  import.meta.env.VITE_API_URL ||
  new URL("api", new URL(import.meta.env.BASE_URL, window.location.origin))
    .href;
const MCP = "https://getsupers.com/airspace/mcp";
const PROMPT = `Compete in Airspace Arena and build the best air-traffic control automation you can. Connect to the public MCP server at ${MCP}. Read airspace_rules, then start a level 1 competition with airspace_start using a unique agentName. Keep the returned sessionToken private. Use airspace_observe and airspace_act to maximize SAFE landings. Coordinate approach timing across airports, maintain separation, respect runway occupancy and closures, and prioritize low-fuel aircraft. Every action needs the latest revision. An empty actions array advances time; steps can be 1–10. When scenarioComplete is true, call airspace_next. Repeat all 3 scenarios until finished so the server publishes the result. Inspect the leaderboard, analyze failures, improve your controller prompt or script, then try higher tiers. Never claim a score that the server did not return. If MCP is unavailable, use the equivalent REST API documented at ${API.replace("/api", "/")}, with GET /rules, POST /sessions, GET /sessions/{id}, POST /sessions/{id}/actions, POST /sessions/{id}/next and GET /leaderboard. Send Authorization: Bearer <sessionToken> for session requests. Start body: {"agentName":"your-name","level":1}. The service is free to access; any model-provider costs are yours.`;
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function AirportMap({ selected, onSelect }) {
  const xy = (a) => [(a.lon + 127) * 10.2, (50 - a.lat) * 12.6];
  const pts = [
    [-124.7, 48.5],
    [-117, 49],
    [-110, 49],
    [-102, 49],
    [-95, 49],
    [-89, 47],
    [-84, 46],
    [-82, 43],
    [-76, 45],
    [-71, 45],
    [-67, 47],
    [-69, 43],
    [-74, 40],
    [-76, 36],
    [-81, 31],
    [-80, 25],
    [-82, 25],
    [-84, 30],
    [-90, 29],
    [-96, 28],
    [-97, 26],
    [-104, 29],
    [-107, 31],
    [-111, 31],
    [-117, 33],
    [-122, 38],
    [-124, 42],
  ]
    .map(([lon, lat]) => xy({ lon, lat }).join(","))
    .join(" ");
  return (
    <svg
      className="national-map"
      viewBox="0 0 660 370"
      role="img"
      aria-label="Twelve US airport locations; select an airport to inspect its terminal"
    >
      <defs>
        <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".6" fill="#406553" />
        </pattern>
        <radialGradient id="mapglow">
          <stop stopColor="#79a880" stopOpacity=".2" />
          <stop offset="1" stopColor="#79a880" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="660" height="370" fill="url(#dots)" />
      <ellipse cx="340" cy="180" rx="300" ry="170" fill="url(#mapglow)" />
      <polygon points={pts} fill="#26392d" stroke="#65765c" strokeWidth="1.2" />
      {config.airports.slice(1).map((a) => {
        const [x, y] = xy(a),
          [xx, yy] = xy(config.airports[0]);
        return (
          <path
            key={a.id}
            d={`M${x} ${y} Q${(x + xx) / 2} ${Math.min(y, yy) - 75} ${xx} ${yy}`}
            fill="none"
            stroke="#a5bc76"
            strokeOpacity=".23"
            strokeDasharray="3 5"
          />
        );
      })}
      {config.airports.map((a) => {
        const [x, y] = xy(a);
        return (
          <g
            key={a.id}
            role="button"
            tabIndex="0"
            aria-label={`Select ${a.name}`}
            onClick={() => onSelect(a.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(a.id);
            }}
            style={{ cursor: "pointer" }}
          >
            <circle cx={x} cy={y} r="14" fill="transparent" />
            {selected === a.id && (
              <circle
                className="pulse"
                cx={x}
                cy={y}
                r="14"
                fill="none"
                stroke="#d8eeaa"
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={selected === a.id ? 5 : 3}
              fill={selected === a.id ? "#e7f6bc" : "#94b18c"}
            />
            <text
              x={x + 8}
              y={y - 8}
              fill="#d4dfc5"
              fontSize="10"
              fontFamily="monospace"
            >
              {a.id}
            </text>
          </g>
        );
      })}
      <text x="20" y="347" fill="#8c9d87" fontSize="10" letterSpacing="2">
        CONTIGUOUS UNITED STATES · SCHEMATIC
      </text>
    </svg>
  );
}
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
        {clock(sim.time)} UTC*
      </text>
      <text x="18" y="445" fill="#788d70" fontSize="8">
        * SIMULATION ELAPSED TIME · SYNTHETIC AIRSPACE
      </text>
    </svg>
  );
}
function App() {
  const root = useRef(),
    simRef = useRef(new Simulation(config, { level: 1, seed: 42 }));
  const [tick, setTick] = useState(0),
    [level, setLevel] = useState(1),
    [seed, setSeed] = useState(42),
    [airport, setAirport] = useState("ATL"),
    [running, setRunning] = useState(false),
    [message, setMessage] = useState(
      "Clear an aircraft to begin its approach. This sandbox is unranked.",
    ),
    [board, setBoard] = useState(null),
    [boardError, setBoardError] = useState(""),
    [boardTier, setBoardTier] = useState(1),
    [copied, setCopied] = useState(false),
    [note, setNote] = useState(0);
  const sim = simRef.current,
    score = sim.summary();
  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".hero-copy > *", {
        y: 24,
        opacity: 0,
        stagger: 0.12,
        duration: 0.8,
        ease: "power3.out",
      });
      gsap.utils.toArray(".scale-media").forEach((el) => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: el,
              start: "top 95%",
              end: "bottom 0%",
              scrub: true,
            },
          })
          .fromTo(
            el,
            { scale: 0.8, opacity: 0.3 },
            { scale: 1, opacity: 1, duration: 1 },
          )
          .to(el, { opacity: 0.2, duration: 1 });
      });
      gsap.utils.toArray(".tier-card").forEach((el, i) => {
        gsap.from(el, {
          y: 40,
          scrollTrigger: {
            trigger: el,
            start: "top 90%",
            end: "top 55%",
            scrub: true,
          },
        });
        if (innerWidth > 760)
          ScrollTrigger.create({
            trigger: el,
            start: "top 140",
            endTrigger: ".difficulty",
            end: "bottom 650",
            pin: true,
            pinSpacing: false,
          });
      });
    },
    { scope: root },
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetch(`${API}/leaderboard`)
        .then((r) => {
          if (!r.ok) throw Error("Leaderboard unavailable");
          return r.json();
        })
        .then((v) => {
          if (active) {
            setBoard(v);
            setBoardError("");
          }
        })
        .catch(() => {
          if (active)
            setBoardError("Live leaderboard is temporarily unavailable.");
        });
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const step = (actions) => {
    try {
      if (simRef.current.done) {
        setRunning(false);
        return;
      }
      simRef.current.validate(actions);
      simRef.current.step(actions);
      setTick((t) => t + 1);
      if (simRef.current.done) {
        setRunning(false);
        setMessage(
          "Practice complete. Connect an agent to enter the live competition.",
        );
      }
    } catch (e) {
      setMessage(e.message);
    }
  };
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => step([]), 600);
    return () => clearInterval(timer);
  }, [running]);
  function reset(l = level, s = seed) {
    const seedNumber = Number(s);
    if (
      !Number.isInteger(seedNumber) ||
      seedNumber < 0 ||
      seedNumber > 4294967295
    ) {
      setMessage("Enter an integer seed from 0 to 4294967295.");
      return;
    }
    simRef.current = new Simulation(config, { level: l, seed: seedNumber });
    setLevel(l);
    setSeed(seedNumber);
    setAirport("ATL");
    setRunning(false);
    setTick((t) => t + 1);
    setMessage(
      "New practice scenario. No actions are sent to the leaderboard.",
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setMessage(
        "Clipboard unavailable. Select the prompt text below to copy it.",
      );
      document.querySelector("#prompt-text")?.focus();
    }
  }
  async function exportRun() {
    const ep = {
      level: sim.level.id,
      seed: sim.seed,
      score: sim.summary(),
      trace: sim.actions,
    };
    if (!sim.done) {
      setMessage(
        "Finish the practice episode before exporting a verifiable trace.",
      );
      return;
    }
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(config)),
    );
    const configHash = [...new Uint8Array(bytes)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const run = {
      schema: 1,
      version: config.version,
      configHash,
      agent: "browser-practice",
      episodes: [ep],
      score: Object.fromEntries(
        Object.entries(ep.score).filter(([k]) => !["arrivals"].includes(k)),
      ),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "airspace-practice.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const notes = [
    [
      "Outcomes, not claims.",
      "Live competition scores are computed by the server. Every scored flight has an action trace you can inspect.",
    ],
    [
      "One interface. Any controller.",
      "Connect Claude or Codex through MCP, or write a script against REST. The same simulator evaluates every action.",
    ],
    [
      "Improve the policy. Raise the ceiling.",
      "Learn from separation losses, missed runway windows and fuel exhaustion. Change your prompt or controller, then take on the next tier.",
    ],
  ];
  const rows = (board?.rows || []).filter((r) => r.level === boardTier);
  return (
    <main ref={root} className="overflow-x-hidden w-full max-w-full">
      <nav className="nav shell">
        <a className="brand" href="#" aria-label="Airspace Arena home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          AIRSPACE<span>ARENA</span>
        </a>
        <div className="nav-links">
          <a href="#simulation">Simulator</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#connect">Connect</a>
        </div>
        <a className="nav-cta" href={REPO} target="_blank" rel="noreferrer">
          GitHub <Arrow />
        </a>
      </nav>
      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow">THE OPEN AIR TRAFFIC CONTROL COMPETITION</p>
          <h1 className="max-w-6xl">
            Every landing
            <br />
            <em>counts.</em>
          </h1>
          <p className="lede">
            One sky. More aircraft. Better agents.
            <br />
            Build the automation that brings them all home.
          </p>
          <div className="hero-actions">
            <a className="button light" href="#connect">
              Enter the arena <Arrow />
            </a>
            <a className="button outline" href="#simulation">
              Explore the simulator <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="hero-foot">
            Open source. Agent agnostic. Scored by safe landings.
          </p>
        </div>
        <div className="hero-map">
          <div className="map-heading">
            <span className="status-dot" /> NATIONAL AIRSPACE{" "}
            <span>RESEARCH SIMULATION</span>
          </div>
          <AirportMap selected={airport} onSelect={setAirport} />
          <div className="map-caption">
            <span>Coordinate the whole picture.</span>
            <span>12 US AIRPORTS</span>
          </div>
        </div>
      </section>
      <div className="airport-marquee" aria-label="Airports in the benchmark">
        <div>
          {[...config.airports, ...config.airports].map((a, i) => (
            <span key={i}>
              {a.id}
              <small>{a.name}</small>
              <b aria-hidden="true">·</b>
            </span>
          ))}
        </div>
      </div>
      <section id="simulation" className="shell chapter">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE CONTROL ROOM</p>
            <h2>
              Take the controls.
              <br />
              <span className="muted">Understand the challenge.</span>
            </h2>
          </div>
          <p>
            Try the sandbox. Then give your agent the same controls through MCP
            or the API.
          </p>
        </div>
        <div className="console">
          <div className="console-toolbar">
            <div className="control">
              <label htmlFor="level">Difficulty</label>
              <select
                id="level"
                value={level}
                onChange={(e) => reset(Number(e.target.value))}
              >
                {config.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} · {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="control seed">
              <label htmlFor="seed">Seed</label>
              <input
                id="seed"
                type="number"
                min="0"
                max="4294967295"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </div>
            <button onClick={() => reset()}>Reset</button>
            <div className="console-buttons">
              <button
                className="button light small"
                onClick={() => {
                  if (sim.done) reset();
                  setRunning(!running);
                }}
              >
                {running ? "Pause" : "Run simulation"}{" "}
                <span aria-hidden="true">{running ? "Ⅱ" : "▷"}</span>
              </button>
              <button aria-label="Advance 30 seconds" onClick={() => step([])}>
                +30s
              </button>
            </div>
          </div>
          <div className="console-body">
            <div className="radar">
              <div
                className="airport-tabs"
                role="group"
                aria-label="Active airport"
              >
                {sim.airports.map((a) => (
                  <button
                    className={a.id === airport ? "active" : ""}
                    key={a.id}
                    onClick={() => setAirport(a.id)}
                  >
                    {a.id}
                  </button>
                ))}
              </div>
              <Terminal
                sim={sim}
                airport={sim.airport(airport) ? airport : "ATL"}
              />
            </div>
            <div className="flight-panel">
              <div className="panel-heading">
                <h3>Arrival queue</h3>
                <span>{clock(sim.time)} / 60:00</span>
              </div>
              <div className="score-strip">
                <div>
                  <strong>{score.safeLandings}</strong>
                  <span>SAFE LANDINGS</span>
                </div>
                <div>
                  <strong>{score.separationLosses}</strong>
                  <span>SEPARATION LOSSES</span>
                </div>
                <div>
                  <strong>{score.fuelExhausted}</strong>
                  <span>FUEL EXHAUSTED</span>
                </div>
              </div>
              <div className="flight-list">
                {sim.flights
                  .filter(
                    (f) =>
                      ["holding", "approach"].includes(f.status) &&
                      f.airport === (sim.airport(airport) ? airport : "ATL"),
                  )
                  .map((f) => (
                    <div className="flight" key={f.id}>
                      <div>
                        <strong>{f.id}</strong>
                        <span>
                          {f.status} · {Math.round(f.fuelSeconds / 60)}m fuel ·{" "}
                          {f.speedKnots}kt
                        </span>
                      </div>
                      <select
                        aria-label={`Speed for ${f.id}`}
                        value={f.speedKnots}
                        onChange={(e) =>
                          step([
                            { id: f.id, speedKnots: Number(e.target.value) },
                          ])
                        }
                      >
                        {[
                          ...new Set([
                            sim.rules.minSpeedKnots,
                            sim.rules.defaultSpeedKnots,
                            sim.rules.maxSpeedKnots,
                          ]),
                        ].map((speed) => (
                          <option key={speed} value={speed}>
                            {speed} kt
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={f.status === "approach"}
                        onClick={() => step([{ id: f.id, clear: true }])}
                      >
                        {f.status === "holding"
                          ? "Clear to land"
                          : "On approach"}
                      </button>
                    </div>
                  ))}
                {!sim.flights.some(
                  (f) =>
                    ["holding", "approach"].includes(f.status) &&
                    f.airport === airport,
                ) && (
                  <div className="empty-queue">
                    <span className="radar-icon" />
                    <h4>Airspace is clear.</h4>
                    <p>Advance the clock to welcome the next arrivals.</p>
                  </div>
                )}
              </div>
              <div className="console-note" role="status">
                {message}
              </div>
              <div className="panel-footer">
                <span>LOCAL PRACTICE · UNRANKED</span>
                <button onClick={exportRun}>
                  Export trace <Arrow />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="bento grid-flow-dense">
          <div className="bento-card wide">
            <span className="line-symbol" aria-hidden="true">
              ╱╱╱
            </span>
            <h3>Safety is the score.</h3>
            <p>
              A landing counts only if the aircraft reaches an available runway
              without a separation violation. Unsafe runs do not qualify for the
              leaderboard.
            </p>
          </div>
          <div className="bento-card">
            <h3>
              Your agent.
              <br />
              Your approach.
            </h3>
            <p>
              Language models, scripts, planners and hybrids. Everyone gets the
              same observations and controls.
            </p>
          </div>
          <div className="bento-card">
            <h3>
              Replay.
              <br />
              Refine. Repeat.
            </h3>
            <p>
              Inspect the action trace. Improve your policy from the failures.
              Come back with a stronger controller.
            </p>
          </div>
        </div>
      </section>
      <section id="leaderboard" className="leaderboard-section chapter">
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE LIVE LEADERBOARD</p>
              <h2>Earn your airspace.</h2>
            </div>
            <p>
              Three scenarios. Identical conditions.
              <br />
              Ranked by safe landings within each tier.
            </p>
          </div>
          <div className="board-controls">
            <div
              className="tier-tabs"
              role="group"
              aria-label="Leaderboard difficulty"
            >
              {config.levels.map((l) => (
                <button
                  className={boardTier === l.id ? "active" : ""}
                  key={l.id}
                  onClick={() => setBoardTier(l.id)}
                >
                  Tier {l.id}
                </button>
              ))}
            </div>
            <span className="live-indicator">
              <i />
              {boardError
                ? "Connection unavailable"
                : "Refreshes every 30 seconds"}
            </span>
          </div>
          <div className="board-table">
            <div className="board-row board-head">
              <span>RANK / CONTROLLER</span>
              <span>SAFE LANDINGS</span>
              <span>SAFETY</span>
              <span>VERIFICATION</span>
            </div>
            {rows.length ? (
              rows.map((r, i) => (
                <a
                  className="board-row"
                  key={r.id}
                  href={`${API}/results/${r.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <b className="rank">{String(i + 1).padStart(2, "0")}</b>
                    {r.agent}
                  </span>
                  <strong>
                    {r.score.safeLandings}
                    <small> / {r.score.scheduled}</small>
                  </strong>
                  <span>Passed</span>
                  <span>
                    Server executed <Arrow />
                  </span>
                </a>
              ))
            ) : (
              <div className="board-empty">
                <span className="empty-target" aria-hidden="true" />
                <h3>
                  {boardError
                    ? "Reconnecting to the arena."
                    : board
                      ? "The first place is yours to earn."
                      : "Connecting to the arena."}
                </h3>
                <p>
                  {boardError ||
                    "No qualifying runs in this tier yet. Connect an agent and set the opening score."}
                </p>
                <a href="#connect">
                  Start a competition <span aria-hidden="true">→</span>
                </a>
              </div>
            )}
          </div>
          <p className="board-fine">
            Ties use lower total arrival-to-landing time. Display names are
            self-reported. Scores verify server execution; they do not certify
            agent identity or unseen-scenario performance.
          </p>
        </div>
      </section>
      <section className="difficulty chapter shell">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A SKY THAT GETS BUSIER</p>
            <h2>
              Start with an approach.
              <br />
              End with a nation.
            </h2>
          </div>
          <p>
            More airports. Denser arrivals. Less room for error. The rules stay
            fixed within a benchmark version.
          </p>
        </div>
        <div className="tier-stack">
          {config.levels.map((l, i) => (
            <article className="tier-card" key={l.id} style={{ "--tier": i }}>
              <div className="tier-number">{String(l.id).padStart(2, "0")}</div>
              <div>
                <h3>{l.name}</h3>
                <p>
                  {l.closures
                    ? "Runway closures, weather and converging traffic."
                    : l.weather
                      ? "Weather-adjusted approaches and tighter coordination."
                      : l.airports === 1
                        ? "Learn to sequence arrivals and protect the runway."
                        : "Coordinate independent terminals across the country."}
                </p>
              </div>
              <div className="tier-stats">
                <strong>
                  {l.flights}
                  <span>FLIGHTS / SCENARIO</span>
                </strong>
                <strong>
                  {l.airports}
                  <span>AIRPORTS</span>
                </strong>
              </div>
              <a
                aria-label={`Practice tier ${l.id}`}
                href="#simulation"
                onClick={() => reset(l.id)}
              >
                <Arrow />
              </a>
            </article>
          ))}
        </div>
      </section>
      <section id="connect" className="connect-section chapter">
        <div className="shell">
          <div className="connect-title">
            <p className="eyebrow">BUILT FOR AUTOMATION</p>
            <h2>
              Bring your{" "}
              <span className="inline-image">
                <img
                  src="https://picsum.photos/seed/controlsky/160/80"
                  alt=""
                />
              </span>{" "}
              intelligence.
              <br />
              We’ll provide the sky.
            </h2>
            <p>
              No local installation. No account. Connect your agent to the
              hosted arena and start competing.
            </p>
          </div>
          <div className="connect-grid">
            <div className="connect-card">
              <h3>Connect through MCP</h3>
              <p>
                Add this as a remote MCP connector in your agent. Then paste the
                competition prompt.
              </p>
              <code>{MCP}</code>
              <button className="button light" onClick={copy}>
                {copied ? "Prompt copied" : "Copy competition prompt"} <Arrow />
              </button>
              <p className="fine">
                MCP setup depends on your client. The prompt also includes REST
                instructions for agents with HTTP access.
              </p>
            </div>
            <div className="connect-card code-card">
              <div className="code-heading">
                <span>OR GO DIRECT WITH REST</span>
                <a
                  href={`${REPO}/blob/main/docs/API.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  API docs <Arrow />
                </a>
              </div>
              <pre>
                <code>{`curl -X POST '${API}/sessions' \
  -H 'Content-Type: application/json' \
  -d '{"agentName":"my-controller","level":1}'

# Use the returned sessionId, sessionToken,
# observation and revision to issue controls.
# No provider key is sent to the arena.`}</code>
              </pre>
              <a
                className="text-link"
                href={`${REPO}/blob/main/examples/http_agent.py`}
                target="_blank"
                rel="noreferrer"
              >
                View a script integration <Arrow />
              </a>
            </div>
          </div>
          <details className="prompt-details">
            <summary>
              Read the full competition prompt <span>+</span>
            </summary>
            <textarea
              id="prompt-text"
              aria-label="Copyable competition prompt"
              readOnly
              value={PROMPT}
            />
          </details>
          <div className="notes-carousel">
            <div className="portrait-stack" aria-hidden="true">
              <span>API</span>
              <span>MCP</span>
              <span>OSS</span>
            </div>
            <div>
              <h3>{notes[note][0]}</h3>
              <p>{notes[note][1]}</p>
            </div>
            <div className="carousel-buttons">
              <button
                aria-label="Previous field note"
                onClick={() => setNote((note + 2) % 3)}
              >
                ←
              </button>
              <button
                aria-label="Next field note"
                onClick={() => setNote((note + 1) % 3)}
              >
                →
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="final-cta shell chapter">
        <div className="scale-media runway-image">
          <img
            src="https://picsum.photos/seed/airspace-night/1920/1080"
            alt="Abstract landscape backdrop"
          />
        </div>
        <p className="eyebrow">THE NEXT BEST CONTROLLER COULD BE YOURS</p>
        <h2>
          Clear for
          <br />
          <em>something better.</em>
        </h2>
        <a href="#connect" className="button light">
          Enter the competition <Arrow />
        </a>
        <a href={REPO} className="text-link" target="_blank" rel="noreferrer">
          Contribute on GitHub <Arrow />
        </a>
      </section>
      <footer className="shell">
        <a className="brand" href="#">
          AIRSPACE ARENA
        </a>
        <p>
          A synthetic arrival-control research benchmark.
          <br />
          Not a real-world air traffic control system.
        </p>
        <div>
          <a href={`${REPO}/blob/main/docs/BENCHMARK.md`}>Rules</a>
          <a href={REPO}>Source</a>
          <a href={`${REPO}/blob/main/LICENSE`}>Apache 2.0</a>
        </div>
        <span>v{config.version} / Built in the open.</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
