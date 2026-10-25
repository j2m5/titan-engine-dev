export function parseCloudBenchmarkOptions(args) {
  const choices = {
    quality: ['low', 'medium', 'high'],
    view: ['above', 'inside'],
    stage: ['cloud-current', 'cloud-resolve', 'shadows', 'depth', 'frame']
  }
  const values = { quality: 'all', view: 'all', stage: 'all', samples: 512, repeats: 2, width: 1920, height: 1080 }
  const seen = new Set()
  for (const arg of args) {
    const match = /^--([a-z]+)=([^=]+)$/.exec(arg)
    if (!match) throw new Error(`Invalid option: ${arg}; use --help`)
    const [, key, value] = match
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown option: ${key}`)
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`)
    seen.add(key)
    if (choices[key]) {
      if (value !== 'all' && !choices[key].includes(value)) throw new Error(`Invalid ${key}: ${value}`)
      values[key] = value
    } else {
      const n = Number(value)
      const valid =
        /^\d+$/.test(value) &&
        Number.isSafeInteger(n) &&
        n > 0 &&
        (key === 'samples' ? n % 64 === 0 && n <= 4096 : key === 'repeats' ? n <= 10 : n <= 7680)
      if (!valid) throw new Error(`Invalid ${key}: ${value}`)
      values[key] = n
    }
  }
  const expand = (key) => (values[key] === 'all' ? [...choices[key]] : [values[key]])
  return {
    qualities: expand('quality'),
    views: expand('view'),
    stages: expand('stage'),
    samples: values.samples,
    repeats: values.repeats,
    width: values.width,
    height: values.height
  }
}
