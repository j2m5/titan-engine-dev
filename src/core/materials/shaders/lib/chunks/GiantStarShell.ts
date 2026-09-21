/**
 * Протяжённая атмосфера звезды-гиганта: аналитический интеграл толщи вдоль
 * луча. Все длины — в единицах радиуса звезды, центр звезды в начале координат.
 * Общий для меша оболочки и билборда-импостора.
 *
 * Зависимость: noiseFunctions (snoise(vec4)) — потребитель включает ДО чанка.
 * Производных здесь нет: гашение «шерсти» считает вызывающая сторона.
 *
 * CPU-зеркало интеграла: src/core/renderables/GiantStar/shellMath.ts.
 */
export const giantStarShell = `
  #define GS_SHELL_STEPS 8
  // Шкала высот как доля полной протяжённости
  #define GS_SHELL_SCALE_FRACTION 0.25
  // Модуляция толщи шумом: амплитуда и частота по единичному направлению.
  // Значения стартовые: приёмку по картинке делает владелец
  #define GS_SHELL_WOOL_AMPLITUDE 0.35
  #define GS_SHELL_WOOL_FREQUENCY 2.0

  // 1 на фотосфере, ровно 0 на верхней границе
  float gsShellDensity(float r, float height) {
    float scale = height * GS_SHELL_SCALE_FRACTION;
    float cut = exp(-height / scale);

    return max(exp(-(r - 1.0) / scale) - cut, 0.0) / (1.0 - cut);
  }

  // Толща до нормировки. dir единичный. Камера внутри оболочки даёт t0 = 0.
  // Дискриминанты — через перпендикуляр к лучу: разность b*b - (oo - R*R) в
  // сотнях радиусов от центра теряет разряды float32 и дрожит на лимбе
  float gsShellTau(vec3 origin, vec3 dir, float height) {
    float b = dot(origin, dir);
    float oo = dot(origin, origin);
    float outer = 1.0 + height;
    vec3 perp = origin - dir * b;
    float p2 = dot(perp, perp);
    float discOuter = outer * outer - p2;

    if (discOuter <= 0.0) return 0.0;

    float rootOuter = sqrt(max(discOuter, 0.0));
    float t0 = max(-b - rootOuter, 0.0);
    float t1 = -b + rootOuter;

    float discCore = 1.0 - p2;
    if (discCore > 0.0) {
      float tCore = -b - sqrt(max(discCore, 0.0));
      if (tCore > 0.0) t1 = min(t1, tCore);
    }

    if (t1 <= t0) return 0.0;

    float dt = (t1 - t0) / float(GS_SHELL_STEPS);
    float sum = 0.0;

    for (int i = 0; i < GS_SHELL_STEPS; i++) {
      float t = t0 + (float(i) + 0.5) * dt;
      sum += gsShellDensity(sqrt(max(oo + 2.0 * b * t + t * t, 0.0)), height);
    }

    return sum * dt;
  }

  // Адрес шума «шерсти» на единичной сфере, связанный с телом. Луч, попавший
  // в фотосферу, адресуется точкой ВХОДА в неё: точка сближения лежала бы под
  // поверхностью, и её направление задавал бы азимут на экране. Мимо
  // фотосферы берётся точка сближения — там набирается основная толща.
  // На прицельном параметре 1 обе точки совпадают
  vec3 gsShellClosestDir(vec3 origin, vec3 dir) {
    float b = dot(origin, dir);
    vec3 perp = origin - dir * b;
    float discCore = 1.0 - dot(perp, perp);
    float tClosest = max(-b, 0.0);
    float tCore = -b - sqrt(max(discCore, 0.0));
    float t = (discCore > 0.0 && tCore > 0.0) ? tCore : tClosest;
    vec3 p = origin + dir * t;

    return p / max(length(p), 1e-6);
  }

  // Множитель толщи. Один вызов на фрагмент, а не на шаг интеграла.
  // fade = 0 возвращает гладкий профиль и не считает шум
  float gsShellWool(vec3 woolDomain, float time, float fade) {
    if (fade <= 0.0) return 1.0;

    float n = (snoise(vec4(woolDomain, time)) + 0.5 * snoise(vec4(woolDomain * 2.0, time))) / 1.5;

    return max(1.0 + GS_SHELL_WOOL_AMPLITUDE * fade * n, 0.0);
  }

  // Эмиссия-поглощение, выход премультиплицирован. Цвет и энергия — холодный
  // стоп палитры фотосферы: верх атмосферы холоднее её
  vec4 giantStarShell(
    vec3 origin, vec3 dir, float height, float densityScale, float wool,
    vec3 coolColor, float coolEnergy, float intensity, float exposure
  ) {
    float tau = gsShellTau(origin, dir, height) * densityScale * wool;
    float alpha = 1.0 - exp(-tau);

    return vec4(coolColor * coolEnergy * intensity * exposure * alpha, alpha);
  }
`
