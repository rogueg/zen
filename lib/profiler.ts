import fetch from 'node-fetch'
const BACKEND_URL = 'https://superhuman.com/~backend'

export type metric = {
  name: string
  fields: Record<string, string | number>
}

export function logBatch(metrics: metric[]) {
  return fetch(`${BACKEND_URL}/v3/metrics.write`, {
    method: 'POST',
    body: JSON.stringify({
      dataset: 'zen',
      metrics,
    }),
  })
}

export function log(name: metric['name'], fields: metric['fields']) {
  return logBatch([{ name, fields }])
}
