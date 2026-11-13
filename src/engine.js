/** Synthetic terminal airspace. No operational ATC use. All units explicit. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hypot = Math.hypot;
const active = (f) => f.status === "holding" || f.status === "approach";
const interval = (p, v, limit) => {
  if (Math.abs(v) < 1e-12) return Math.abs(p) < limit ? [0, 1] : null;
  const a = (-limit - p) / v,
    b = (limit - p) / v;
  const lo = Math.max(0, Math.min(a, b)),
    hi = Math.min(1, Math.max(a, b));
  return lo < hi ? [lo, hi] : null;
};
/** Exact intersection of horizontal and vertical open separation cylinders on a linear segment. */
export function sweptConflict(a0, a1, b0, b1, horizontal, vertical) {
  const px = a0.x - b0.x,
    py = a0.y - b0.y;
  const vx = a1.x - b1.x - px,
    vy = a1.y - b1.y - py;
  const A = vx * vx + vy * vy,
    B = 2 * (px * vx + py * vy),
    C = px * px + py * py - horizontal * horizontal;
  let h;
  if (A < 1e-12) h = C < 0 ? [0, 1] : null;
  else {
    const d = B * B - 4 * A * C;
    if (d <= 0) return false;
    h = [
      Math.max(0, (-B - Math.sqrt(d)) / (2 * A)),
      Math.min(1, (-B + Math.sqrt(d)) / (2 * A)),
    ];
    if (h[0] >= h[1]) return false;
  }
  if (!h) return false;
  const z = interval(
    a0.altitudeFt - b0.altitudeFt,
    a1.altitudeFt - b1.altitudeFt - a0.altitudeFt + b0.altitudeFt,
    vertical,
  );
  return !!z && Math.max(h[0], z[0]) < Math.min(h[1], z[1]);
}
export class Simulation {
  constructor(config, { level = 1, seed = 42, stress = 1 } = {}) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295)
      throw new Error("Seed must be uint32");
    if (!Number.isFinite(stress) || stress < 1 || stress > 10)
      throw new Error("Stress must be in [1,10]");
    this.config = structuredClone(config);
    this.rules = this.config.rules;
    this.level = this.config.levels.find((l) => l.id === level);
    if (!this.level) throw new Error("Unknown level");
    this.seed = seed;
    this.stress = stress;
    this.time = 0;
    this.events = [];
    this.frames = [];
    this.actions = [];
    this.errors = 0;
    this.lossPairs = new Set();
    this.collisionPairs = new Set();
    const rng = random(seed),
      r = this.rules;
    this.airports = this.config.airports
      .slice(0, this.level.airports)
      .map((a) => ({
        ...a,
        busyUntil: 0,
        weather: +(rng() * this.level.weather).toFixed(3),
        closed: false,
      }));
    const counts = Object.fromEntries(this.airports.map((a) => [a.id, 0]));
    this.flights = Array.from(
      { length: Math.round(this.level.flights * stress) },
      (_, i) => {
        const airport = this.airports[Math.floor(rng() * this.airports.length)];
        const n = counts[airport.id]++,
          angle = ((n % r.gateCount) * 2 * Math.PI) / r.gateCount;
        const radius =
          r.gateRadiusNm + Math.floor(n / r.gateCount) * r.gateRingSpacingNm;
        return {
          id: `AA${String(i + 1).padStart(4, "0")}`,
          airport: airport.id,
          spawn:
            Math.floor((rng() * r.arrivalWindowSeconds) / r.stepSeconds) *
            r.stepSeconds,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          fixX: Math.cos(angle) * radius,
          fixY: Math.sin(angle) * radius,
          phase: rng() * 2 * Math.PI,
          altitudeFt: r.holdingAltitudeFt,
          speedKnots: r.defaultSpeedKnots,
          fuelSeconds: r.fuelSeconds,
          status: "scheduled",
          unsafe: false,
          landedAt: null,
        };
      },
    ).sort((a, b) => a.spawn - b.spawn || a.id.localeCompare(b.id));
    this.activate();
  }
  get done() {
    return this.time >= this.rules.durationSeconds;
  }
  airport(id) {
    return this.airports.find((a) => a.id === id);
  }
  closedAt(a, t) {
    return (
      this.level.closures &&
      this.airports.indexOf(a) % 3 === 0 &&
      t >= this.rules.closureStartSeconds &&
      t < this.rules.closureEndSeconds
    );
  }
  activate() {
    for (const f of this.flights)
      if (f.status === "scheduled" && f.spawn <= this.time) {
        f.status = "holding";
        const p = this.holdPosition(f, this.time);
        Object.assign(f, p);
        this.event("arrival", [f.id], f.airport);
      }
    for (const a of this.airports) a.closed = this.closedAt(a, this.time);
  }
  event(type, flights, airport = null) {
    this.events.push({ time: this.time, type, flights, airport });
  }
  holdPosition(f, t) {
    const phase = f.phase + (t / this.rules.holdingPeriodSeconds) * 2 * Math.PI;
    return {
      x: f.fixX + Math.cos(phase) * this.rules.holdingRadiusNm,
      y: f.fixY + Math.sin(phase) * this.rules.holdingRadiusNm,
    };
  }
  observation() {
    return {
      version: this.config.version,
      time: this.time,
      remainingSeconds: this.rules.durationSeconds - this.time,
      rules: this.rules,
      airports: structuredClone(this.airports),
      aircraft: this.flights
        .filter(active)
        .map((f) => ({
          ...f,
          distanceNm: hypot(f.x, f.y),
          estimatedArrivalSeconds:
            (hypot(f.x, f.y) /
              (f.speedKnots * (1 - this.airport(f.airport).weather))) *
            3600,
        })),
      recentEvents: this.events.slice(-12),
      score: this.summary(),
    };
  }
  validate(actions) {
    if (
      !Array.isArray(actions) ||
      actions.length > this.rules.maxActionsPerStep
    )
      throw new Error("actions must be a bounded array");
    const ids = new Set();
    for (const c of actions) {
      if (
        !c ||
        typeof c !== "object" ||
        Object.keys(c).some((k) => !["id", "clear", "speedKnots"].includes(k))
      )
        throw new Error("Unknown command field");
      const f = this.flights.find((f) => f.id === c.id);
      if (!f || !active(f) || ids.has(c.id))
        throw new Error("Unknown, inactive or duplicate aircraft");
      ids.add(c.id);
      if ("clear" in c && (c.clear !== true || f.status !== "holding"))
        throw new Error("clear must be true for holding aircraft");
      if (
        "speedKnots" in c &&
        (!Number.isFinite(c.speedKnots) ||
          c.speedKnots < this.rules.minSpeedKnots ||
          c.speedKnots > this.rules.maxSpeedKnots)
      )
        throw new Error("Speed out of bounds");
    }
  }
  step(commands = []) {
    if (this.done) throw new Error("Episode finished");
    let accepted = commands;
    try {
      this.validate(commands);
    } catch (error) {
      this.errors++;
      this.event("invalid-action", []);
      accepted = [];
    }
    this.actions.push({
      time: this.time,
      actions: structuredClone(accepted),
      rejected: accepted !== commands,
    });
    for (const c of accepted) {
      const f = this.flights.find((f) => f.id === c.id);
      if (c.speedKnots !== undefined) f.speedKnots = c.speedKnots;
      if (c.clear) {
        f.status = "approach";
        f.approachAltitude = f.altitudeFt;
        f.approachDistance = hypot(f.x, f.y);
        this.event("cleared", [f.id], f.airport);
      }
    }
    // One-second piecewise-linear integration; swept tests prevent tunneling between samples.
    const until = Math.min(
      this.time + this.rules.stepSeconds,
      this.rules.durationSeconds,
    );
    while (this.time < until) {
      const flying = this.flights.filter(active),
        old = new Map(flying.map((f) => [f.id, { ...f }]));
      const arrivals = [];
      for (const f of flying) {
        f.fuelSeconds--;
        if (f.status === "holding")
          Object.assign(f, this.holdPosition(f, this.time + 1));
        else {
          const dist = hypot(f.x, f.y),
            step =
              (f.speedKnots * (1 - this.airport(f.airport).weather)) / 3600;
          const fraction = Math.max(0, dist - step) / Math.max(dist, 1e-12);
          f.x *= fraction;
          f.y *= fraction;
          // Linear descent from the assigned holding level to the abstract runway threshold.
          f.altitudeFt =
            (f.approachAltitude * hypot(f.x, f.y)) / f.approachDistance;
          if (dist <= step) arrivals.push(f);
        }
      }
      for (let i = 0; i < flying.length; i++)
        for (let j = i + 1; j < flying.length; j++) {
          const a = flying[i],
            b = flying[j];
          if (a.airport !== b.airport) continue;
          const key = [a.id, b.id].sort().join(":");
          if (
            sweptConflict(
              old.get(a.id),
              a,
              old.get(b.id),
              b,
              this.rules.horizontalSeparationNm,
              this.rules.verticalSeparationFt,
            )
          ) {
            a.unsafe = b.unsafe = true;
            if (!this.lossPairs.has(key)) {
              this.lossPairs.add(key);
              this.event("separation-loss", [a.id, b.id], a.airport);
            }
          }
          if (
            sweptConflict(
              old.get(a.id),
              a,
              old.get(b.id),
              b,
              this.rules.collisionNm,
              this.rules.collisionFt,
            )
          ) {
            a.status = b.status = "crashed";
            if (!this.collisionPairs.has(key)) {
              this.collisionPairs.add(key);
              this.event("collision", [a.id, b.id], a.airport);
            }
          }
        }
      this.time++;
      // A fuel exhaustion at the threshold is not a safe landing.
      for (const f of flying)
        if (active(f) && f.fuelSeconds <= 0) {
          f.status = "fuel-exhausted";
          this.event("fuel-exhausted", [f.id], f.airport);
        }
      for (const f of arrivals)
        if (active(f)) {
          const a = this.airport(f.airport);
          if (this.closedAt(a, this.time) || a.busyUntil > this.time) {
            f.status = "runway-incident";
            f.unsafe = true;
            this.event("runway-incident", [f.id], f.airport);
          } else {
            f.status = "landed";
            f.landedAt = this.time;
            a.busyUntil =
              this.time + this.rules.runwayOccupancySeconds * (1 + a.weather);
            this.event(
              f.unsafe ? "unsafe-landing" : "safe-landing",
              [f.id],
              f.airport,
            );
          }
        }
      this.activate();
    }
    return this.observation();
  }
  summary() {
    const n = (status) =>
      this.flights.filter((f) => f.status === status).length;
    const landed = this.flights.filter((f) => f.status === "landed");
    return {
      safeLandings: landed.filter((f) => !f.unsafe).length,
      totalLandings: landed.length,
      scheduled: this.flights.length,
      arrivals: this.flights.filter((f) => f.spawn <= this.time).length,
      separationLosses: this.lossPairs.size,
      collisions: this.collisionPairs.size,
      runwayIncidents: n("runway-incident"),
      fuelExhausted: n("fuel-exhausted"),
      unfinished: this.flights.filter(active).length,
      agentErrors: this.errors,
      totalDelaySeconds: landed.reduce((s, f) => s + f.landedAt - f.spawn, 0),
      eligible:
        this.lossPairs.size === 0 &&
        this.collisionPairs.size === 0 &&
        n("runway-incident") === 0 &&
        this.errors === 0,
    };
  }
}
