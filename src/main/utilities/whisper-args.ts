// Единый источник аргументов whisper-cli для транскрипции (TRANS-03, D-11/D-14).
//
// Импортируется И раннером (esbuild --bundle инлайнит этот модуль в whisper-runner.cjs),
// И интеграционным тестом — чтобы args не разъезжались между прод-вызовом и тестом.
// Зеркало src/main/utilities/ffmpeg-args.ts.
//
// КОНТРАКТ: чистая функция без импортов из `electron` или main-графа — безопасна
// для utility-bundle (см. ffmpeg-args.ts §КОНТРАКТ, Pitfall #5).
//
// Источник: 03-RESEARCH.md §buildTranscribeArgs (376-401), §VAD Parameters (175-195).

export interface TranscribeOpts {
  /** Абсолютный путь к ggml-модели (userData/models/ggml-<name>.bin). */
  modelPath: string
  /** Абсолютный путь к WAV (mono 16kHz PCM из Phase 2 D-01) — НЕ ресемплить (Pitfall 7). */
  audioPath: string
  /** Язык: 'ru' | 'auto' | ... ('auto' → whisper-cli автодетект). */
  language: string
  /** Путь к silero VAD-модели или null (без VAD). */
  vadModelPath: string | null
  /** Число CPU-потоков. */
  threads: number
}

/**
 * Собирает флаги whisper-cli:
 *   -m <model> -l <language> -pp -oj -t <threads> -f <audio>
 *   (+ --vad -vm <vadModel> если задана VAD-модель).
 *
 * -pp  — прогресс в stderr (D-11);
 * -oj  — JSON-файл рядом с входом (авторитетный источник для .md);
 * -f   — входной WAV as-is (TRANS-03, Pitfall 7).
 */
export function buildTranscribeArgs(o: TranscribeOpts): string[] {
  const args = [
    '-m',
    o.modelPath,
    '-l',
    o.language,
    '-pp',
    '-oj',
    '-t',
    String(o.threads),
    '-f',
    o.audioPath
  ]
  if (o.vadModelPath) {
    args.push('--vad', '-vm', o.vadModelPath) // D-14
  }
  return args
}
