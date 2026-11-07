# Дело №1 «Двадцать третий этаж» — изображения

Пять требований к каждому кадру (общие для всех):

1. **Формат:** 1600×900 (16:9), `.png` или `.jpg`, имя — как в таблице ниже, в папке `cases/case-01/assets/`.
2. **Без текста на картинке.** Ни штампов, ни даты, ни логотипов: подпись кадра, имя камеры и таймкод рисует интерфейс игры.
3. **Лица не опознаваемые.** Капюшон, шарф, вид сзади, смаз от движения — но не чёрный прямоугольник и не размытие «как в Photoshop».
4. **Кровь — минимально.** Тёмные пятна/потёки, без деталей травм: кадр должен оставаться доказательством, а не хоррором.
5. **Юридическое.** Никаких реальных брендов, логотипов, узнаваемых зданий и известных людей. Всё вымышленное.

Стиль всего дела: офисный нуар, зима, вечер. Фото — вспышка камериста, холодный цвет, зерно 35 мм. Камеры — широкоугольный потолок, ИК-подсветка, шум, лёгкая компрессия.

---

## Слоты

| материал | файл | что в кадре |
|---|---|---|
| e01 | `e01-stairwell.svg` | пролёт 22–23, тело, лужица, метки |
| e03 | `e03-office-2308.svg` | кабинет Смолина, нетронутый |
| e04 | `e04-archive-2314.svg` | архивная ниша, пустой кронштейн ОП-5 |
| e05 | `e05-cam-w14.svg` | камера холла: выход из 23-14, манжета с запонкой |
| e07 | `e07-container.svg` | контейнер на −1: пуховик, жилет, баллон |
| e09 | `e09-cam-l01.svg` | турникет лобби, 21:40, красный пуховик |
| e12 | `e12-cam-g04.svg` | зона разгрузки, 23:03, складывает в контейнер |
| e34 | `e34-corporate.svg` | корпоратив 25.12: мужчина в красном пуховике |

---

## Промпты

### e01 — лестничный пролёт (фото с места)

```
Documentary forensic photograph, modern Russian office business center, February night.
Interior concrete-and-tile stairwell landing between floors, shot from above looking down
the flight of stairs. Wet grey tiled steps with melting snow slush, harsh on-camera flash,
cold desaturated palette, slight film grain. A man in a dark business suit lies face down
on the landing in shadow, positioned unnaturally flat, no visible wounds, no blood splatter
detail, body partly cropped by the frame edge. Two yellow triangular evidence marker tent
cards on the step. Realistic crime-scene report photo, wide 16:9 composition.
Absolutely no text, no watermark, no timestamp, no logos.
```

### e03 — кабинет 23-08

```
Documentary forensic photograph of an undisturbed executive office at night, modern Russian
business center, 23rd floor. Shot with harsh on-camera flash, cold desaturated palette,
slight grain. Large desk: computer monitor glowing with a plain dark screensaver,
a half-drunk glass of tea with a film on the surface, a folded sheet of paper, a leather
eyeglass case with expensive rimless glasses beside it. On a coat rack near the door hangs
a beige wool overcoat, dry and neatly buttoned. Office chair pushed out, blinds half open
with city lights behind. Nobody in frame. Wide 16:9, evidence-report realism.
No text, no captions, no watermark, no logos, no readable screen content.
```

### e04 — архивная ниша 23-14

```
Forensic photograph, narrow office archive room, metal shelving units stacked with identical
cardboard file boxes, dim cold fluorescent light. On the wall an empty red metal fire
extinguisher bracket with a small hanging tag, faint dark drips below it on the wall and a
few fibres of blue non-woven fabric caught on the bracket. On the worn linoleum floor near
the third shelf a dark stain about 30 by 18 cm with drag marks leading toward the door.
A black magnetic rubber door wedge lies by the door. Harsh camera flash, cold palette,
35 mm grain, documentary evidence photo, 16:9. No text, no watermark, no logos, no body.
```

### e05 — камера `W-14`, холл архива, 22:12:36

```
CCTV surveillance frame, high ceiling corner camera, wide-angle lens, night indoor office
corridor with archive doors. A person in a blue sleeveless contractor safety vest over a
dark hooded jacket steps out of a half-open door, face hidden by the hood, one hand raised
near chest level showing a light shirt cuff with a round metal cufflink, the other hand
holds a cylindrical object pointing down. Infrared night look, desaturated grey-blue,
heavy video noise, slight motion blur, compression artefacts, vignetting at corners.
Grainy low-resolution surveillance aesthetic, 16:9. No text, no timestamp, no watermark,
no logos.
```

### e07 — контейнер на −1

```
Documentary photograph, underground loading area of an office building, next to a large
grey plastic waste container with the lid open, harsh flashlight from the side, concrete
walls, cold palette, 35 mm grain. On top of the trash: a blue sleeveless contractor work
vest, a red hooded down jacket with wet shoulders, and a powder fire extinguisher lying
on its side with a dented cylinder and broken seal tag. No people in frame. Evidence
documentation style, 16:9. No text, no watermark, no labels, no logos.
```

### e09 — камера `L-01`, турникет лобби, 21:40:33

```
CCTV frame from a ceiling camera above a lobby turnstile line at night, wide-angle, glass
doors and reception desk visible, empty lobby, cold infrared look with video noise and
compression artefacts. A man passes the turnstile outward, three-quarter view away from
camera: red hooded down jacket with the hood up, dark scarf pulled over the nose, no
glasses, broad shoulders, about 180 cm, no bag. Motion blur on the moving figure, height
marks on the wall behind. Surveillance aesthetic, 16:9. No text, no timestamp, no
watermark, no logos.
```

### e12 — камера `G-04`, зона разгрузки, 23:03:22

```
CCTV night frame, basement loading dock of an office building, ceiling camera at a steep
angle, concrete floor, metal roller door, waste containers in a row. A heavy-set man in a
red down jacket without hood and a blue work vest leans over an open container, placing
something soft inside; side profile, short haircut, no beard, face not clearly readable
due to low light and video noise. He wears dark leather city shoes with a raised heel, not
work boots. Infrared greyscale-blue palette, strong grain, compression blocking, 16:9.
No text, no timestamp, no watermark, no logos.
```

### e34 — фото корпоратива 25.12.2024

```
Candid corporate holiday party photograph taken indoors at night: office staff in smart
casual clothes near a small stage with tinsel and balloons, warm tungsten light mixed with
a camera flash, slight blur, amateur snapshot look with date-era phone camera quality.
On the right side a man in a bright red hooded down jacket worn over a shirt with cufflinks
holds a glass of champagne, face turned away mid-laugh, unrecognisable; beside him an older
man in rimless glasses without a jacket. Party atmosphere, 16:9 crop. No text, no watermark,
no logos, no readable banners.
```

---

## Статус

Сейчас в игре все 8 слотов заняты **векторными схемами** (`*.svg`, нарисованы вручную,
лежат в `assets/`): план места, план кабинета, план архивной ниши, схемы трёх камер,
разрез контейнера и копия фотографии с корпоратива. Решение осознанное — приложение
должно работать без генератора картинок и без интернета, а схема лучше фотографии
держивает то, на чём стоит расследованию: размеры, расстояния, метки, выносы.

Промпты выше — задел на «фотореалистичную» версию: если сгенерировать растровый кадр с теми же
именами файлов и положить рядом в `assets/`, достаточно поменять расширение в поле `img`
у соответствующего материала (или добавить вторым слоем). Код править не нужно: читалка
показывает картинку, если файл по пути существует, и описание кадра — если нет
(класс `.shot-ph`). Проверка путей и целостности схем: `node tools/check.mjs`
(отсутствующий файл — предупреждение, не ошибка; `tools/check-svg.mjs` следит за форматом схем).

Оформление схем: «бумага под миллиметровку» для планов (фон `#e8e2d4`, размеры синим
`#1f6f8f`, значимые следы красным `#a8321f`, нумерованные метки жёлтым треугольником,
штамп «Схема № …» в правом нижнем углу) и тёмный «кадр» для камер (`#101820`, линии
`#cfe3e8`). Таймкод и имя камеры для материалов типа `cctv` поверх рисует интерфейс,
поэтому нижний левый угол в таких схемах остаётся свободным.

## Библиотека фактуры (на всё приложение, один раз)

Для следующих дел уникальные кадры не нужны в том же количестве: фактура бумаги, штампов,
рамки CCTV и экрана мессенджера делается один раз и переиспользуется, на дело остаётся
4–6 уникальных изображений. Кандидаты в библиотеку:

| файл | назначение |
|---|---|
| `assets/tex-paper-*.png` | 3–4 варианта фактуры бумаги/крафта под документами |
| `assets/tex-cctv-frame.png` | виньетка + шум поверх любого CCTV-кадра |
| `assets/stamp-*.png` | штампы «КОПИЯ ВЕРНА», «ДЛ», «СЭД» |
| `assets/tex-screen.png` | блик/пиксельная сетка для писем и чатов |
