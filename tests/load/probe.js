// Minimal probe: one endpoint, fixed VUs, to compare network paths (edge nginx vs direct API).
import http from 'k6/http';
import { sleep } from 'k6';
export const options = {
  vus: Number(__ENV.VUS || 40),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'count'],
};
const URL = __ENV.URL;
export default function () {
  http.get(URL);
  sleep(Number(__ENV.SLEEP || 0.5));
}
