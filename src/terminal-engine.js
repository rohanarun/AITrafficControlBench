import { random, sweptConflict } from "./legacy-engine.js";
const rad = Math.PI / 180;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = (x) => ((x % 360) + 360) % 360;
const delta = (to, from) => ((to - from + 540) % 360) - 180;
const bearing = (x, y) => wrap(Math.atan2(x, y) / rad);
const airborne = (f) =>
  [
    "holding",
    "vector",
    "intercept",
    "approach",
    "go-around",
    "departure",
  ].includes(f.status);
const controllable = (f) => airborne(f) || f.status === "ready";
const finished = (f) =>
  [
    "landed",
    "departed",
    "crashed",
    "fuel-exhausted",
    "runway-incident",
    "escaped",
  ].includes(f.status);
export class TerminalSimulation {
  constructor(
    config,
    { level = config.levels[0].id, seed = 42, stress = 1 } = {},
  ) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
      throw Error("Seed must be uint32");
    if (!Number.isFinite(stress) || stress < 1 || stress > 10)
      throw Error("Stress must be in [1,10]");
    this.config = structuredClone(config);
    this.level = this.config.levels.find((l) => l.id === level);
    if (!this.level) throw Error("Unknown level");
    this.rules = { ...config.rules, ...this.level.rules };
    this.seed = seed;
    this.stress = stress;
    this.time = 0;
    this.events = [];
    this.actions = [];
    this.frames = [];
    this.errors = 0;
    this.lossPairs = new Set();
    this.collisionPairs = new Set();
    this.airports = structuredClone(config.airports).map((a) => ({
      ...a,
      busyUntil: 0,
      lastWake: null,
      closed: false,
      weather: 0,
    }));
    const rng = random(seed),
      r = this.rules,
      a = this.airports[0];
    const count = Math.round(this.level.flights * stress),
      departures = Math.round(this.level.departures * stress);
    let arrivalTime = 0;
    this.flights = Array.from({ length: count }, (_, i) => {
      const departure = i >= count - departures,
        n = departure ? i - (count - departures) : i;
      const profile = structuredClone(
        config.aircraftProfiles[
          Math.floor(rng() * config.aircraftProfiles.length)
        ],
      );
      if (!departure && n >= r.initialArrivals)
        arrivalTime +=
          (r.arrivalWindowSeconds /
            Math.max(1, count - departures - r.initialArrivals)) *
          (0.8 + 0.4 * rng());
      const angle = ((n % r.entryLanes) * 2 * Math.PI) / r.entryLanes;
      const radius = r.entryRadiusNm;
      const fixX = Math.sin(angle) * radius,
        fixY = Math.cos(angle) * radius;
      const f = {
        id: `AA${String(i + 1).padStart(4, "0")}`,
        airport: a.id,
        kind: departure ? "departure" : "arrival",
        profile,
        spawn: departure
          ? Math.floor(
              (Math.max(0, n - r.initialDepartureQueue + 1) *
                r.arrivalWindowSeconds) /
                Math.max(1, departures - r.initialDepartureQueue) /
                r.stepSeconds,
            ) * r.stepSeconds
          : Math.floor(arrivalTime / r.stepSeconds) * r.stepSeconds,
        x: departure ? 0 : fixX + r.holdingRadiusNm,
        y: departure ? 0 : fixY,
        fixX,
        fixY,
        altitudeFt: departure
          ? a.elevationFt
          : r.holdingAltitudeFt + (Math.floor(n / r.entryLanes) % 5) * 2000,
        speedKnots: departure ? 0 : r.defaultSpeedKnots,
        headingDeg: departure ? a.runway.headingDeg : 0,
        verticalSpeedFpm: 0,
        targetHeadingDeg: 0,
        targetSpeedKnots: r.defaultSpeedKnots,
        targetAltitudeFt: 0,
        status: "scheduled",
        unsafe: false,
        landedAt: null,
        completedAt: null,
        fuelSeconds: r.fuelSeconds * (0.85 + 0.3 * rng()),
        fuelUsedKg: 0,
        distanceFlownNm: 0,
        airborneSeconds: 0,
        holdingSeconds: 0,
        goArounds: 0,
        pilotDelaySeconds: Math.floor(
          r.pilotDelayMinSeconds +
            rng() * (r.pilotDelayMaxSeconds - r.pilotDelayMinSeconds + 1),
        ),
        pending: [],
        history: [],
        track: null,
        interceptStage: 0,
      };
      f.targetHeadingDeg = f.headingDeg;
      f.targetAltitudeFt = f.altitudeFt;
      return f;
    }).sort((a, b) => a.spawn - b.spawn || a.id.localeCompare(b.id));
    this.activate();
    this.sampleTracks();
  }
  get done() {
    return this.time >= this.rules.durationSeconds;
  }
  airport(id) {
    return this.airports.find((a) => a.id === id);
  }
  closedAt(a, t) {
    return (
      !!this.level.closures &&
      t >= this.rules.closureStartSeconds &&
      t < this.rules.closureEndSeconds
    );
  }
  event(type, flights, airport = this.airports[0].id) {
    this.events.push({ time: this.time, type, flights, airport });
  }
  activate() {
    for (const f of this.flights)
      if (f.status === "scheduled" && f.spawn <= this.time) {
        f.status = f.kind === "departure" ? "ready" : "holding";
        this.event(f.kind === "departure" ? "departure-ready" : "arrival", [
          f.id,
        ]);
      }
    for (const a of this.airports) {
      a.closed = this.closedAt(a, this.time);
      a.wind = this.windAt(0);
    }
  }
  windAt(altitudeFt) {
    const r = this.rules,
      phase =
        (this.time / r.windPeriodSeconds) * 2 * Math.PI +
        (this.seed % 360) * rad;
    // Reproducible evolving wind; observed now, not a perfect future forecast.
    return {
      eastKnots:
        r.windBaseKnots +
        Math.sin(phase) * r.windVariationKnots +
        (altitudeFt / 1000) * r.windShearKnotsPer1000Ft,
      northKnots: Math.cos(phase * 0.7) * r.windVariationKnots,
    };
  }
  runwayCoordinates(f) {
    const rw = this.airport(f.airport).runway,
      h = rw.headingDeg * rad;
    const x = f.x - rw.thresholdX,
      y = f.y - rw.thresholdY;
    return {
      along: x * Math.sin(h) + y * Math.cos(h),
      cross: x * Math.cos(h) - y * Math.sin(h),
    };
  }
  waypoint(distance) {
    const rw = this.airports[0].runway,
      h = rw.headingDeg * rad;
    return {
      x: rw.thresholdX - distance * Math.sin(h),
      y: rw.thresholdY - distance * Math.cos(h),
    };
  }
  validate(actions) {
    if (
      !Array.isArray(actions) ||
      actions.length > this.rules.maxActionsPerStep
    )
      throw Error("actions must be a bounded array");
    const ids = new Set(),
      allowed = [
        "id",
        "clear",
        "speedKnots",
        "headingDeg",
        "altitudeFt",
        "hold",
        "goAround",
        "takeoff",
      ];
    for (const c of actions) {
      if (
        !c ||
        typeof c !== "object" ||
        Object.keys(c).some((k) => !allowed.includes(k))
      )
        throw Error("Unknown command field");
      const f = this.flights.find((f) => f.id === c.id);
      if (!f || !controllable(f) || ids.has(c.id))
        throw Error("Unknown, inactive or duplicate aircraft");
      ids.add(c.id);
      const modes = ["clear", "hold", "goAround", "takeoff"].filter(
        (k) => k in c,
      );
      if (modes.length > 1 || modes.some((k) => c[k] !== true))
        throw Error("Choose one true mode command");
      if (c.takeoff && f.status !== "ready")
        throw Error("takeoff requires a ready departure");
      if (f.status === "ready" && !c.takeoff)
        throw Error("Ready departures require takeoff");
      if ((c.clear || c.goAround || c.hold) && f.kind !== "arrival")
        throw Error("Arrival command for a departure");
      if (
        "headingDeg" in c &&
        (!Number.isFinite(c.headingDeg) ||
          c.headingDeg < 0 ||
          c.headingDeg >= 360)
      )
        throw Error("Heading must be true degrees [0,360)");
      if (
        "altitudeFt" in c &&
        (!Number.isFinite(c.altitudeFt) ||
          c.altitudeFt < this.rules.minVectorAltitudeFt ||
          c.altitudeFt > this.rules.maxAltitudeFt)
      )
        throw Error("Vector altitude outside MSL bounds");
      if (
        "speedKnots" in c &&
        (!Number.isFinite(c.speedKnots) ||
          c.speedKnots < f.profile.minSpeedKnots ||
          c.speedKnots > this.rules.maxSpeedKnots)
      )
        throw Error("Speed outside aircraft IAS envelope");
      if (f.pending.length)
        throw Error(
          "Await pending pilot acknowledgement before issuing another command to this aircraft",
        );
      if (
        (c.clear || c.hold || c.goAround || c.takeoff) &&
        ("headingDeg" in c || "altitudeFt" in c)
      )
        throw Error("Mode command supplies guidance; issue vectors separately");
    }
  }
  goAround(f, reason) {
    f.status = "go-around";
    f.targetHeadingDeg = this.airport(f.airport).runway.headingDeg;
    f.targetAltitudeFt = this.rules.goAroundAltitudeFt;
    f.targetSpeedKnots = Math.max(
      f.profile.approachSpeedKnots + 20,
      f.speedKnots,
    );
    f.goArounds++;
    f.interceptStage = 0;
    this.event(reason, [f.id]);
  }
  apply(f, c) {
    if (!controllable(f)) return;
    if (c.takeoff) {
      const a = this.airport(f.airport);
      if (
        a.closed ||
        a.busyUntil > this.time ||
        (a.lastWake &&
          this.time - a.lastWake.time < this.rules.departureWakeSeconds)
      ) {
        f.unsafe = true;
        f.status = "runway-incident";
        this.event("unsafe-takeoff", [f.id]);
        return;
      }
      f.status = "takeoff-roll";
      f.headingDeg = a.runway.headingDeg;
      f.targetHeadingDeg = f.headingDeg;
      f.targetAltitudeFt = this.rules.goAroundAltitudeFt;
      f.targetSpeedKnots = this.rules.defaultSpeedKnots;
      a.busyUntil =
        this.time +
        Math.ceil(
          f.profile.takeoffSpeedKnots /
            f.profile.takeoffAccelerationKnotsPerSecond,
        ) +
        15;
      a.lastWake = { time: this.time, category: f.profile.wake, id: f.id };
      this.event("takeoff", [f.id]);
    }
    if (c.goAround) this.goAround(f, "commanded-go-around");
    if (c.hold) {
      f.status = "holding";
      const h = f.headingDeg * rad;
      f.fixX = f.x - this.rules.holdingRadiusNm * Math.cos(h);
      f.fixY = f.y + this.rules.holdingRadiusNm * Math.sin(h);
      f.targetAltitudeFt = Math.max(
        this.rules.minVectorAltitudeFt,
        f.altitudeFt,
      );
    }
    if (c.clear) {
      f.status = "intercept";
      f.interceptStage = 0;
      f.targetAltitudeFt = this.airport(
        f.airport,
      ).procedure.interceptAltitudeFt;
      f.targetSpeedKnots = f.profile.approachSpeedKnots;
      this.event("approach-cleared", [f.id]);
    }
    if ("headingDeg" in c) {
      f.targetHeadingDeg = c.headingDeg;
      if (f.kind === "arrival") f.status = "vector";
    }
    if ("altitudeFt" in c) {
      f.targetAltitudeFt = c.altitudeFt;
      if (f.status === "approach") f.status = "vector";
    }
    if ("speedKnots" in c) f.targetSpeedKnots = c.speedKnots;
    this.event("pilot-acknowledged", [f.id]);
  }
  guide(f) {
    const r = this.rules,
      a = this.airport(f.airport),
      rw = a.runway,
      p = this.runwayCoordinates(f),
      distance = -p.along;
    let course = f.targetHeadingDeg;
    if (f.status === "holding") {
      const dx = f.x - f.fixX,
        dy = f.y - f.fixY,
        d = Math.hypot(dx, dy),
        theta = Math.atan2(dy, dx);
      course = bearing(
        -Math.sin(theta) -
          ((d - r.holdingRadiusNm) / r.holdingRadiusNm) * Math.cos(theta),
        Math.cos(theta) -
          ((d - r.holdingRadiusNm) / r.holdingRadiusNm) * Math.sin(theta),
      );
    }
    if (f.status === "intercept") {
      const point = this.waypoint(r.approachCaptureDistanceNm);
      if (Math.hypot(f.x - point.x, f.y - point.y) < 3) f.interceptStage = 1;
      course = f.interceptStage
        ? wrap(rw.headingDeg + clamp(-p.cross * 10, -25, 25))
        : bearing(point.x - f.x, point.y - f.y);
      const glide =
        a.elevationFt +
        rw.thresholdCrossingHeightFt +
        Math.max(0, distance) * 6076.12 * Math.tan(rw.glideAngleDeg * rad);
      if (
        distance > r.stabilizedDistanceNm &&
        distance < r.approachCaptureDistanceNm &&
        Math.abs(p.cross) < r.approachCaptureCrossTrackNm &&
        Math.abs(delta(rw.headingDeg, f.headingDeg)) <
          r.approachCaptureHeadingDeg &&
        f.altitudeFt <= glide + r.approachCaptureAltitudeToleranceFt
      ) {
        f.status = "approach";
        this.event("localizer-captured", [f.id]);
      } else if (f.interceptStage && distance < r.stabilizedDistanceNm)
        this.goAround(f, "failed-approach-capture");
    }
    if (f.status === "approach") {
      course = wrap(rw.headingDeg + clamp(-p.cross * 20, -25, 25));
      const glide =
        a.elevationFt +
        rw.thresholdCrossingHeightFt +
        Math.max(0, distance) * 6076.12 * Math.tan(rw.glideAngleDeg * rad);
      f.targetAltitudeFt = Math.min(f.altitudeFt, glide);
      if (
        distance <= r.stabilizedDistanceNm &&
        (Math.abs(f.altitudeFt - glide) > r.stabilizedHeightToleranceFt ||
          Math.abs(p.cross) > r.landingCrossTrackNm * 2 ||
          Math.abs(f.speedKnots - f.profile.approachSpeedKnots) >
            r.landingSpeedToleranceKnots ||
          a.closed ||
          a.busyUntil >
            this.time +
              (Math.max(0, distance) /
                Math.max(1, f.groundSpeedKnots || f.speedKnots)) *
                3600)
      ) {
        this.goAround(f, "unstable-or-blocked-go-around");
        course = f.targetHeadingDeg;
      }
    }
    // Track guidance compensates crosswind; a vector command remains a true heading instruction.
    if (["holding", "intercept", "approach"].includes(f.status)) {
      const wind = this.windAt(f.altitudeFt),
        tas = this.trueAirspeed(f),
        h = course * rad;
      const cross =
        wind.eastKnots * Math.cos(h) - wind.northKnots * Math.sin(h);
      course = wrap(
        course - Math.asin(clamp(cross / Math.max(1, tas), -0.8, 0.8)) / rad,
      );
    }
    return course;
  }
  trueAirspeed(f) {
    return f.speedKnots / Math.sqrt(Math.exp(-f.altitudeFt / 29000));
  }
  move(f) {
    const r = this.rules,
      a = this.airport(f.airport),
      old = { ...f },
      roll = f.status === "takeoff-roll";
    if (f.status === "landing-roll") {
      f.speedKnots = Math.max(
        0,
        f.speedKnots - r.landingDecelerationKnotsPerSecond,
      );
      f.altitudeFt = Math.max(a.elevationFt, f.altitudeFt - 8);
      f.verticalSpeedFpm = 0;
      const h = a.runway.headingDeg * rad;
      f.x += (f.speedKnots * Math.sin(h)) / 3600;
      f.y += (f.speedKnots * Math.cos(h)) / 3600;
      f.distanceFlownNm += f.speedKnots / 3600;
      f.fuelUsedKg += f.profile.fuelBurnKgPerSecond * 0.2;
      if (Math.hypot(f.x, f.y) > a.runway.lengthNm) {
        f.status = "crashed";
        f.unsafe = true;
        this.event("runway-overrun", [f.id]);
      }
      return old;
    }
    const course = roll ? a.runway.headingDeg : this.guide(f);
    const accel = roll
      ? f.profile.takeoffAccelerationKnotsPerSecond
      : r.accelerationKnotsPerSecond;
    f.speedKnots += clamp(f.targetSpeedKnots - f.speedKnots, -accel, accel);
    const tas = this.trueAirspeed(f),
      turn =
        (9.80665 * Math.tan(r.bankAngleDeg * rad)) /
        Math.max(1, tas * 0.514444) /
        rad;
    f.headingDeg = wrap(
      f.headingDeg + clamp(delta(course, f.headingDeg), -turn, turn),
    );
    const desired = roll
      ? 0
      : clamp(
          (f.targetAltitudeFt - f.altitudeFt) * 60,
          -f.profile.maxDescentFpm,
          f.profile.maxClimbFpm,
        );
    f.verticalSpeedFpm += clamp(
      desired - f.verticalSpeedFpm,
      -r.verticalAccelerationFtPerSecond2 * 60,
      r.verticalAccelerationFtPerSecond2 * 60,
    );
    f.altitudeFt += f.verticalSpeedFpm / 60;
    const wind = roll
      ? { eastKnots: 0, northKnots: 0 }
      : this.windAt(f.altitudeFt);
    const vx = tas * Math.sin(f.headingDeg * rad) + wind.eastKnots,
      vy = tas * Math.cos(f.headingDeg * rad) + wind.northKnots;
    f.x += vx / 3600;
    f.y += vy / 3600;
    f.groundSpeedKnots = Math.hypot(vx, vy);
    f.distanceFlownNm += f.groundSpeedKnots / 3600;
    f.airborneSeconds += roll ? 0 : 1;
    if (f.status === "holding") f.holdingSeconds++;
    const burn =
      f.profile.fuelBurnKgPerSecond *
      (f.verticalSpeedFpm > 0 ? 1.35 : 1) *
      (0.8 + (0.2 * f.speedKnots) / r.defaultSpeedKnots);
    f.fuelUsedKg += burn;
    f.fuelSeconds -= burn / f.profile.fuelBurnKgPerSecond;
    if (roll && f.speedKnots >= f.profile.takeoffSpeedKnots) {
      f.status = "departure";
      this.event("airborne", [f.id]);
    }
    if (roll && Math.hypot(f.x, f.y) > a.runway.lengthNm) {
      f.status = "crashed";
      f.unsafe = true;
      this.event("runway-overrun", [f.id]);
    }
    if (!roll && f.altitudeFt < a.elevationFt) {
      f.status = "crashed";
      f.unsafe = true;
      this.event("ground-collision", [f.id]);
    }
    if (f.fuelSeconds <= 0 && !finished(f)) {
      f.status = "fuel-exhausted";
      this.event("fuel-exhausted", [f.id]);
    }
    return old;
  }
  safety(flying, old) {
    const r = this.rules;
    for (let i = 0; i < flying.length; i++)
      for (let j = i + 1; j < flying.length; j++) {
        const a = flying[i],
          b = flying[j],
          key = [a.id, b.id].sort().join(":");
        let horizontal = r.horizontalSeparationNm;
        const pa = this.runwayCoordinates(a),
          pb = this.runwayCoordinates(b);
        const leader = pa.along > pb.along ? a : b,
          follower = leader === a ? b : a;
        const wakeAligned =
          Math.abs(pa.cross - pb.cross) < r.wakeLateralNm &&
          Math.abs(delta(a.headingDeg, b.headingDeg)) < 30 &&
          follower.altitudeFt <= leader.altitudeFt + r.wakeVerticalFt;
        if (wakeAligned)
          horizontal = Math.max(
            horizontal,
            r.wakeSeparationNm[leader.profile.wake][follower.profile.wake],
          );
        if (
          airborne(old.get(a.id)) &&
          airborne(old.get(b.id)) &&
          sweptConflict(
            old.get(a.id),
            a,
            old.get(b.id),
            b,
            horizontal,
            r.verticalSeparationFt,
          )
        ) {
          a.unsafe = b.unsafe = true;
          a.violationSeconds = (a.violationSeconds || 0) + 1;
          b.violationSeconds = (b.violationSeconds || 0) + 1;
          if (!this.lossPairs.has(key)) {
            this.lossPairs.add(key);
            this.event(
              horizontal > r.horizontalSeparationNm
                ? "wake-separation-loss"
                : "separation-loss",
              [a.id, b.id],
            );
          }
        }
        if (
          sweptConflict(
            old.get(a.id),
            a,
            old.get(b.id),
            b,
            r.collisionNm,
            r.collisionFt,
          )
        ) {
          a.status = b.status = "crashed";
          a.unsafe = b.unsafe = true;
          if (!this.collisionPairs.has(key)) {
            this.collisionPairs.add(key);
            this.event("collision", [a.id, b.id]);
          }
        }
      }
  }
  touchdown(f, old) {
    if (f.status !== "approach") return;
    const p = this.runwayCoordinates(f),
      before = this.runwayCoordinates(old),
      r = this.rules,
      a = this.airport(f.airport);
    if (before.along < 0 && p.along >= 0) {
      if (
        Math.abs(p.cross) > r.landingCrossTrackNm ||
        Math.abs(delta(a.runway.headingDeg, f.headingDeg)) >
          r.landingHeadingToleranceDeg ||
        Math.abs(
          f.altitudeFt - a.elevationFt - a.runway.thresholdCrossingHeightFt,
        ) > r.stabilizedHeightToleranceFt ||
        this.closedAt(a, this.time) ||
        a.busyUntil > this.time
      ) {
        this.goAround(f, "threshold-go-around");
        return;
      }
      // Threshold crossing starts landing rollout; no score until runway is vacated.
      f.status = "landing-roll";
      f.rolloutUntil = this.time + f.profile.rolloutSeconds;
      f.landedAt = this.time;
      a.busyUntil = f.rolloutUntil;
      a.lastWake = { time: this.time, category: f.profile.wake, id: f.id };
      this.event("touchdown", [f.id]);
      // Wake requirement also applies when the leader crosses the threshold.
      for (const other of this.flights)
        if (other.id !== f.id && other.status === "approach") {
          const q = this.runwayCoordinates(other),
            minimum = r.wakeSeparationNm[f.profile.wake][other.profile.wake];
          if (
            q.along < 0 &&
            -q.along < minimum &&
            Math.abs(q.cross) < r.wakeLateralNm
          ) {
            f.unsafe = other.unsafe = true;
            const key = [f.id, other.id].sort().join(":");
            if (!this.lossPairs.has(key)) {
              this.lossPairs.add(key);
              this.event("wake-threshold-loss", [f.id, other.id]);
            }
          }
        }
    }
  }
  sampleTracks() {
    const r = this.rules;
    for (const f of this.flights)
      if (f.status !== "scheduled") {
        f.history.push({
          time: this.time,
          x: f.x,
          y: f.y,
          altitudeFt: f.altitudeFt,
          speedKnots: f.speedKnots,
          headingDeg: f.headingDeg,
          verticalSpeedFpm: f.verticalSpeedFpm,
          groundSpeedKnots: f.groundSpeedKnots || 0,
        });
        if (
          f.history.length >
          r.sensorLatencySeconds + r.sensorPeriodSeconds + 2
        )
          f.history.shift();
        if (!f.track || this.time % r.sensorPeriodSeconds === 0) {
          const sample =
            [...f.history]
              .reverse()
              .find((h) => h.time <= this.time - r.sensorLatencySeconds) ||
            f.history[0];
          f.track = {
            ...sample,
            x:
              Math.round(sample.x / r.sensorPositionResolutionNm) *
              r.sensorPositionResolutionNm,
            y:
              Math.round(sample.y / r.sensorPositionResolutionNm) *
              r.sensorPositionResolutionNm,
            altitudeFt:
              Math.round(sample.altitudeFt / r.sensorAltitudeResolutionFt) *
              r.sensorAltitudeResolutionFt,
            speedKnots: Math.round(sample.speedKnots),
            headingDeg: Math.round(sample.headingDeg) % 360,
          };
        }
      }
  }
  observation() {
    return {
      version: this.config.version,
      time: this.time,
      remainingSeconds: this.rules.durationSeconds - this.time,
      rules: this.rules,
      airports: structuredClone(this.airports),
      aircraft: this.flights
        .filter(
          (f) =>
            controllable(f) ||
            ["takeoff-roll", "landing-roll"].includes(f.status),
        )
        .map((f) => {
          const { history, track, pending, pilotDelaySeconds, ...visible } = f;
          return {
            ...visible,
            ...track,
            trackTime: track?.time ?? this.time,
            time: undefined,
            distanceNm: Math.hypot(track?.x ?? f.x, track?.y ?? f.y),
            pendingCommands: pending.map((p) => ({
              issuedAt: p.issuedAt,
              command: p.command,
            })),
            fuelSeconds: Math.round(f.fuelSeconds),
            wind: this.windAt(track?.altitudeFt ?? f.altitudeFt),
          };
        }),
      recentEvents: this.events.slice(-20),
      score: this.summary(),
    };
  }
  step(commands = []) {
    if (this.done) throw Error("Episode finished");
    let accepted = commands;
    try {
      this.validate(commands);
    } catch {
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
      f.pending.push({
        issuedAt: this.time,
        executeAt: this.time + f.pilotDelaySeconds,
        command: structuredClone(c),
      });
    }
    const until = Math.min(
      this.time + this.rules.stepSeconds,
      this.rules.durationSeconds,
    );
    while (this.time < until) {
      this.activate();
      for (const f of this.flights) {
        while (f.pending.length && f.pending[0].executeAt <= this.time)
          this.apply(f, f.pending.shift().command);
        if (f.status === "landing-roll" && this.time >= f.rolloutUntil) {
          f.status = "landed";
          f.completedAt = this.time;
          this.event(f.unsafe ? "unsafe-landing" : "safe-landing", [f.id]);
        }
      }
      const flying = this.flights.filter(
          (f) =>
            airborne(f) || ["takeoff-roll", "landing-roll"].includes(f.status),
        ),
        old = new Map();
      for (const f of flying) old.set(f.id, this.move(f));
      // Exclude aircraft on the ground from airborne separation, not from physical collision checks with other rolling traffic.
      this.safety(flying, old);
      this.time++;
      for (const f of flying) {
        this.touchdown(f, old.get(f.id));
        if (
          f.status === "departure" &&
          Math.hypot(f.x, f.y) > this.rules.handoffDistanceNm &&
          f.altitudeFt >= this.rules.minimumDepartureAltitudeFt
        ) {
          f.status = "departed";
          f.completedAt = this.time;
          this.event("sector-handoff", [f.id]);
        }
        if (
          airborne(f) &&
          Math.hypot(f.x, f.y) > this.rules.handoffDistanceNm * 3
        ) {
          f.status = "escaped";
          this.event("uncontrolled-sector-exit", [f.id]);
        }
      }
      this.activate();
      this.sampleTracks();
    }
    return this.observation();
  }
  summary() {
    const count = (s) => this.flights.filter((f) => f.status === s).length;
    const landed = this.flights.filter((f) => f.status === "landed"),
      departed = this.flights.filter((f) => f.status === "departed");
    const completed = this.flights.filter(
      (f) => ["landed", "departed"].includes(f.status) && !f.unsafe,
    );
    const safeLandings = landed.filter((f) => !f.unsafe).length,
      safeDepartures = departed.filter((f) => !f.unsafe).length;
    const unservedTimeSeconds = this.flights.reduce(
      (s, f) =>
        s +
        Math.max(
          0,
          (completed.includes(f) ? f.completedAt : this.time) - f.spawn,
        ),
      0,
    );
    const runwayIncidents = count("runway-incident"),
      groundCrashes = this.events.filter((e) =>
        ["runway-overrun", "ground-collision"].includes(e.type),
      ).length;
    return {
      safeLandings,
      totalLandings: landed.length,
      scheduled: this.flights.length,
      scheduledArrivals: this.flights.filter((f) => f.kind === "arrival")
        .length,
      scheduledDepartures: this.level.departures * this.stress,
      arrivals: this.flights.filter((f) => f.spawn <= this.time).length,
      safeDepartures,
      totalDepartures: departed.length,
      separationLosses: this.lossPairs.size,
      collisions: this.collisionPairs.size + groundCrashes,
      runwayIncidents,
      fuelExhausted: count("fuel-exhausted"),
      unfinished: this.flights.filter(
        (f) =>
          controllable(f) ||
          ["takeoff-roll", "landing-roll"].includes(f.status),
      ).length,
      escaped: count("escaped"),
      agentErrors: this.errors,
      totalDelaySeconds: landed.reduce((s, f) => s + f.landedAt - f.spawn, 0),
      unservedTimeSeconds,
      fuelUsedKg: +this.flights
        .reduce((s, f) => s + f.fuelUsedKg, 0)
        .toFixed(3),
      distanceFlownNm: +this.flights
        .reduce((s, f) => s + f.distanceFlownNm, 0)
        .toFixed(3),
      airborneSeconds: this.flights.reduce((s, f) => s + f.airborneSeconds, 0),
      holdingSeconds: this.flights.reduce((s, f) => s + f.holdingSeconds, 0),
      goArounds: this.flights.reduce((s, f) => s + f.goArounds, 0),
      violationAircraftSeconds: this.flights.reduce(
        (s, f) => s + (f.violationSeconds || 0),
        0,
      ),
      timeToCompleteSeconds:
        completed.length === this.flights.length
          ? Math.max(...completed.map((f) => f.completedAt))
          : null,
      completedFlightSeconds: completed.reduce(
        (s, f) => s + f.completedAt - f.spawn,
        0,
      ),
      simulatedSeconds: this.time,
      eligible:
        !this.lossPairs.size &&
        !this.collisionPairs.size &&
        !groundCrashes &&
        !runwayIncidents &&
        !this.errors,
    };
  }
}
