// Единый источник аргументов ffmpeg для извлечения аудио (D-01 + D-08).
//
// Импортируется И раннером (esbuild --bundle инлайнит этот модуль в ffmpeg-runner.cjs),
// И интеграционным тестом — чтобы args не разъезжались между прод-вызовом и тестом.
//
// КОНТРАКТ: чистая функция без импортов из `electron` или main-графа — безопасна
// для utility-bundle (см. ffmpeg-runner.ts §КОНТРАКТ, Pitfall #5).
//
// Выход: mono 16kHz PCM s16le WAV — канонический вход whisper.cpp.

export function buildExtractArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    // Явный муксер WAV. БЕЗ него ffmpeg выбирает формат по расширению выходного
    // файла; прод-tmpPath `<hash>.wav.tmp` → расширение `.tmp` неизвестно →
    // "Unable to choose an output format ... Invalid argument" (exit EINVAL).
    // Root cause packaged-smoke Jun 6 2026; гард — extract-real.test.ts "regression 02-06".
    '-f',
    'wav',
    '-progress',
    'pipe:1',
    '-y',
    outputPath
  ]
}
