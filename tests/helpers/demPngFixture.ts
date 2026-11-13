// Independently encoded grayscale PNG: 8 x 1, unsigned 16-bit samples
// [0, 1, 255, 256, 10000, 10001, 32768, 65535]. No Sharp encode/decode round trip.
export const DEM_16BIT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAABEAAAAACW+2zcAAAAGUlEQVR4nGNgYGBgZPjPyKAuoC7YwPD/PwATAQPvTRsvSgAAAABJRU5ErkJggg==',
  'base64'
)
