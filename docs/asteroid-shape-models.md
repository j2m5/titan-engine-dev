# Реальные модели форм астероидов

Хвост библиотеки архетипов колец (`AsteroidProfiles.shapeModels`, доля
`realShare`) занимают модели настоящих малых тел. Рантайм грузит бинарники
`asteroids/shapes/<имя>_{l0,near}.bin` тем же путём, что карты высот, и по
приходу подменяет процедурную заглушку в стримах пула
(`InstancePool.replaceArchetypeGeometry`). Пока файла нет или он не
загрузился, камень остаётся процедурным осколком.

## Конвейер

1. Скачать модели в любую папку (форматы: Wavefront OBJ или табличная
   plate-модель PDS — первая строка `nv nf`, затем вершины и грани, с ведущим
   номером или без). Имя файла без расширения, в нижнем регистре, становится
   именем архетипа и обязано совпадать со строкой в `shapeModels` профиля.
2. `npm run build:shape-models -- --src <папка>` — центрирование по объёмному
   центроиду, нормировка максимального радиуса в 1, два яруса
   (`scripts/lib/shapeModel.ts`, `TIER_TRIANGLES`), запись в
   `storage/images/textures/asteroids/shapes/`.
3. `npm run cloud:manifest -- --check` — пути моделей входят в манифест
   автоматически (`shapeModelManifestPaths`), затем обычный синк бакета.

## Имена в профилях и источники

| Имя | Тело | Профиль | Источник |
| --- | --- | --- | --- |
| itokawa | 25143 Itokawa | stony | PDS SBN, Hayabusa (Gaskell shape model) |
| eros | 433 Eros | stony | PDS SBN, NEAR Shoemaker (Gaskell) |
| gaspra | 951 Gaspra | stony | PDS SBN, Galileo (Thomas) |
| ida | 243 Ida | stony | PDS SBN, Galileo (Thomas) |
| steins | 2867 Šteins | stony | PDS SBN / ESA PSA, Rosetta |
| lutetia | 21 Lutetia | stony | ESA PSA, Rosetta |
| toutatis | 4179 Toutatis | stony | PDS SBN, радарная модель (Hudson) |
| bennu | 101955 Bennu | carbonaceous | PDS SBN, OSIRIS-REx (OLA/SPC) |
| ryugu | 162173 Ryugu | carbonaceous | JAXA DARTS, Hayabusa2 (SFM/SPC) |
| mathilde | 253 Mathilde | carbonaceous | PDS SBN, NEAR (Thomas) |
| kleopatra | 216 Kleopatra | metallic | PDS SBN, радарная модель (Ostro) |
| psyche | 16 Psyche | metallic | DAMIT (инверсия кривых блеска) |
| epimetheus | Epimetheus | icy | PDS SBN, Cassini (Thomas) |
| janus | Janus | icy | PDS SBN, Cassini (Thomas) |
| pandora | Pandora | icy | PDS SBN, Cassini (Thomas) |
| prometheus | Prometheus | icy | PDS SBN, Cassini (Thomas) |
| phobos | Phobos | icy | PDS SBN, Viking/MEX (Gaskell/Thomas) |
| deimos | Deimos | icy | PDS SBN, Viking (Thomas) |

Модели PDS SBN и JAXA DARTS — public domain (данные NASA/JAXA), при
публикации демки достаточно ссылки на архив. Модели DAMIT (Ďurech et al.) —
CC BY 4.0: в титрах указывать «Shape models from DAMIT, Ďurech, Sidorin &
Kaasalainen (2010)». Если какая-то модель недоступна, её имя можно убрать из
`shapeModels` профиля: список идёт по кругу, слоты займут остальные.

## Ограничения

- Реальная модель — только форма: атрибуты `surfaceData` (свежесть скола,
  каверна) у неё нулевые, микрослой и освещение общие с процедурными.
- Нормировка на максимальный радиус, как у процедурных: сильно вытянутые тела
  (Клеопатра, Тоутатис) в среднем выглядят меньше округлых при том же масштабе
  инстанса. Это ожидаемо и совпадает с поведением процедурных двойных.
