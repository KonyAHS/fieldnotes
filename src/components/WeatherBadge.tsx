import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
} from "lucide-react";
import { type Weather, weatherNote } from "../whereabouts";
function Icon({
  code,
  size,
}: {
  code: number | null | undefined;
  size: number;
}) {
  const C =
    code == null
      ? Cloud
      : code === 0
        ? Sun
        : code <= 2
          ? CloudSun
          : code === 3
            ? Cloud
            : code <= 48
              ? CloudFog
              : code <= 57
                ? CloudDrizzle
                : code <= 67 || (code >= 80 && code <= 82)
                  ? CloudRain
                  : code <= 86
                    ? CloudSnow
                    : CloudLightning;
  return <C size={size} aria-hidden="true" />;
}
// A day's weather in a line: icon, high/low and chance of rain. Last year's
// weather (before forecasts are available) is marked with "≈".
export function WeatherBadge({
  weather: w,
  size = 13,
  rain = true,
}: {
  weather: Weather;
  size?: number;
  rain?: boolean;
}) {
  const typical = w.source !== "forecast";
  const chance = /^(\d+)%/.exec(w.rain)?.[1];
  return (
    <span
      className={`weather-badge ${typical ? "typical" : ""}`}
      title={weatherNote(w)}
    >
      <Icon code={w.code} size={size} />
      {w.tempMax !== null && w.tempMin !== null && (
        <span>
          {typical && "≈"}
          {Math.round(w.tempMax)}°/{Math.round(w.tempMin)}°
        </span>
      )}
      {rain && chance && Number(chance) >= 20 && (
        <span className="weather-rain">{chance}%</span>
      )}
    </span>
  );
}
