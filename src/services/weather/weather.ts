// Today 화면 구석의 작은 날씨 위젯용. API 키가 필요 없는 Open-Meteo를 사용하고,
// 실패하면 위젯만 조용히 숨긴다.

export interface WeatherNow {
  temp: number;
  icon: string;
  label: string;
}

export interface WeatherService {
  current(lat: number, lon: number): Promise<WeatherNow | null>;
}

function describe(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀', label: '맑음' };
  if (code <= 2) return { icon: '⛅', label: '구름 조금' };
  if (code === 3) return { icon: '☁', label: '흐림' };
  if (code <= 48) return { icon: '🌫', label: '안개' };
  if (code <= 67 || (code >= 80 && code <= 82)) return { icon: '☂', label: '비' };
  if (code <= 77 || code === 85 || code === 86) return { icon: '❄', label: '눈' };
  return { icon: '⚡', label: '뇌우' };
}

const CACHE_MS = 30 * 60 * 1000;

export const openMeteoWeather: WeatherService = {
  async current(lat, lon) {
    const key = `mtw.weather.${lat.toFixed(2)},${lon.toFixed(2)}`;
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        const { at, data } = JSON.parse(cached) as { at: number; data: WeatherNow };
        if (Date.now() - at < CACHE_MS) return data;
      }
    } catch {
      /* 저장소 사용 불가 */
    }
    if (!navigator.onLine) return null;
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
      if (!res.ok) return null;
      const j = (await res.json()) as { current: { temperature_2m: number; weather_code: number } };
      const data = { temp: Math.round(j.current.temperature_2m), ...describe(j.current.weather_code) };
      try {
        sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
      } catch {
        /* 무시 */
      }
      return data;
    } catch {
      return null;
    }
  },
};
