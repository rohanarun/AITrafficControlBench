export function compareScores(a, b) {
  return (
    b.safeLandings - a.safeLandings ||
    (b.safeDepartures || 0) - (a.safeDepartures || 0) ||
    (a.timeToCompleteSeconds ?? Infinity) -
      (b.timeToCompleteSeconds ?? Infinity) ||
    (a.unservedTimeSeconds ?? a.totalDelaySeconds) -
      (b.unservedTimeSeconds ?? b.totalDelaySeconds) ||
    (a.fuelUsedKg || 0) - (b.fuelUsedKg || 0)
  );
}
