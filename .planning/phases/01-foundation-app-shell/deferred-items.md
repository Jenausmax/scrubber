# Deferred Items — Phase 01

## DEF-01: Flaky tests in secrets-store / secrets-persist (shared tmpdir)

**Discovered:** Plan 01-04, Task 2 (2026-05-28)
**Status:** Out of scope for Plan 01-04 (pre-existing).

### Описание

`src/main/services/secrets-store.test.ts` и `tests/integration/secrets-persist.test.ts`
оба используют общий путь `os.tmpdir()/scrubber-test/userData` для эмуляции `app.getPath('userData')`.
Vitest гоняет тестовые файлы параллельно (`pool: forks` дефолт) — между двумя файлами возникает
гонка за один и тот же `secrets.bin`. В `beforeEach` файл удаляется (`fs.rm`), что иногда стирает
данные, которые другой тест успел записать на этой же миллисекунде.

Симптом: периодически (1-3 fails из 41) падают тесты `SHELL-02 round-trip` —
после `save → new init` ожидается `data: true`, приходит `data: false` (файл удалили).

Baseline (HEAD = 49572b9, до Settings.tsx Task 2): один прогон зелёный 41/41.
После добавления Settings.tsx: периодически 38-40/41. Settings.tsx не задевает secrets-store —
изменилось только число файлов в `vitest collect`, что переключило timing pool'а форков.

### Почему deferred

- Renderer-код Plan 01-04 не задевает `secrets-store.ts` / `secrets-persist.test.ts`.
- Проблема существовала и до Wave 4 (Vitest default `pool: forks` параллельный).
- Фикс — изоляция через `os.tmpdir() + crypto.randomUUID()` per-test или `pool: 'forks'`
  с `singleFork: true` для этих двух файлов — но это правка тестовой инфраструктуры
  Wave 2/3, не Wave 4.

### Recommended fix (Phase 2 hardening или hotfix-plan)

1. В `tests/setup.ts` (или прямо в `secrets-store.test.ts`/`secrets-persist.test.ts`):
   заменить хардкод `os.tmpdir()/scrubber-test/userData` на per-suite уникальный путь
   через `os.tmpdir()/scrubber-test/${crypto.randomUUID()}/userData`.
2. Или в `vitest.config.ts` зафиксировать `pool: 'forks'` + `poolOptions.forks.singleFork: true`
   только для этих двух файлов через `test.sequence.concurrent: false`.

### Acceptance gate отметка

`npm run test:unit` для Plan 01-04 НЕ блокирующий (флаки не вызвано изменениями плана).
Manual rerun обычно проходит. Build + typecheck зелёные стабильно.
