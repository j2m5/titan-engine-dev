# Earth cloud source maps

The four JPEGs are the project's original maps, downloaded on 2026-10-14 from
`https://storage.yandexcloud.net/textures/planets/earth/`. They are stored without
resizing or recoloring. Dimensions and SHA256 were measured with `sharp.metadata()`
and Node's SHA256 implementation after download.

- `earth.jpg`: surface, resource 24, sRGB, 8192 × 4096.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth.jpg
  SHA256: `d9ebb28b82cfad6c47ae9231fadb339accb72aad2fa31ae42dabbd93d75058dc`
- `earth_clouds.jpg`: clouds, resource 26, sRGB, 8192 × 4096.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth_clouds.jpg
  SHA256: `1a6ed73ee39b1a6dfb516b257cf94866de84222bc6a67648dbe6738c6801aa82`
  The source JPEG is grayscale; browser decoding supplies RGB values.
- `earth_night.jpg`: night emission, resource 27, sRGB, 4096 × 2048.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth_night.jpg
  SHA256: `631b6fb83bdb75b0ffb8732fb82898b64ab28ebdffc5b9103706b4a72c50a05c`
- `earth_specular.jpg`: specular data, resource 91, NoColorSpace, 4096 × 2048.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth_specular.jpg
  SHA256: `b4551b94d90bbfc3cc8df022c08f0718d1cda7c90e59f87c9a9297dc1e56d491`

Visual inspection confirmed a surface geography map, separate cloud structures,
night city lights, and an ocean/land specular mask. Download availability does not
establish a new license; these retain the project's source provenance.

`loadEarthTextures` owns the four original textures and releases successful loads
if any asset fails. Its returned `dispose` is idempotent and deduplicates textures.

`prepareRgbCloudTextures` reads the full natural source dimensions, converts sRGB
once, decodes coverage as `sqrt(mean(linearRGB))`, and computes linear albedo as
`min(linearRGB / max(coverage, 1e-4), 1)`. It averages decoded fields using area
overlap before quantizing to bytes. The default maximum width is 2048, so the
8192 × 4096 cloud source produces 2048 × 1024 weather/color maps. It never
upscales. The original source remains owned by its loader; preparation owns only
its two derived textures. Weather R is coverage and its other channels are zero.
Color RGB is linear albedo and alpha is 255. Derived maps have NoColorSpace,
flipY=false, repeated longitude, clamped latitude, mipmaps and linear filtering.

The source texture's flipY is baked into derived rows. Source wrapping, matrix
and color space are preserved. The shared image reader keeps Jupiter's default
1024-wide HTML image reduction and full-size byte DataTexture path.

With the existing Vite server at port 8086, run the isolated map probe:

```powershell
node scripts/check-earth-cloud-lab.mjs --probe=maps
```

The runner opens only the local `tests/clouds/earth/probe.html` in a temporary
headless Chromium profile. It writes `tmpscreenshots/earth-cloud-lab/maps-report.json`.
The probe checks RGB decoding through actual sRGB GPU uploads, natural HTML image
dimensions, both flipY orientations, repeated longitude samples, the bound mask
weather path, cloud scattering color independence from alpha, shadow/extinction
independence from color, shader compilation, GL errors, and released resources.
