import Zen from './index'

export type metric = {
  name: string
  fields: Record<string, string | number>
}

export function logBatch(metrics: metric[]) {
  let log = Zen.config.log
  if (!log) return

  return log(metrics)
}

export function log(name: metric['name'], fields: metric['fields']) {
  return logBatch([{ name, fields }])
}
