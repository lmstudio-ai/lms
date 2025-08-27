const sec = 1000;
const min = 60 * sec;
const hour = 60 * min;

export function formatElapsedTime(timeMs: number) {
  const segments = [];
  let started = false;
  if (timeMs >= hour) {
    const hours = Math.floor(timeMs / hour);
    segments.push(`${hours}h`);
    timeMs -= hours * hour;
    started = true;
  }
  if (timeMs >= min || started) {
    const minutes = Math.floor(timeMs / min);
    segments.push(`${minutes}m`);
    timeMs -= minutes * min;
    started = true;
  }
  if (timeMs >= sec || started) {
    segments.push(`${(timeMs / sec).toFixed(2)}s`);
    started = true;
  }
  if (!started) {
    segments.push(`${timeMs.toFixed(2)}ms`);
  }
  return segments.join(" ");
}

export function formatTimeLean(ms: number) {
  if (ms >= hour) return `${Math.round(ms / hour)}h`;
  if (ms >= min) return `${Math.round(ms / min)}m`;
  return `${Math.round(ms / 1000)}s`;
}
