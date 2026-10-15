// Preserve existing mode labels, including combined routes, without rewriting saved plans.
export const transportModes = [
  "Train",
  "Shinkansen",
  "Flight",
  "Ferry",
  "Bus",
  "Taxi",
  "Metro",
  "Walk",
  "Other",
];
export function modeOptions(current: string) {
  return current && !transportModes.includes(current)
    ? [current, ...transportModes]
    : transportModes;
}
