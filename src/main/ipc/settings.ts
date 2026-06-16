// IPC handlers для settings namespace (D-08..D-11).
//
// Источник: 01-RESEARCH.md §Pattern 2 (нижний блок), §Common Pitfalls #7.
//
// КОНТРАКТ:
//   - 4 канала из Channels.SETTINGS_* (никаких строковых литералов вне shared/ipc.ts).
//   - Все handler'ы возвращают Result-тип; никаких сырых throw через границу IPC (Pitfall #7).
//   - Валидация типа аргументов руками (V5 ASVS, без zod в Phase 1).
//   - НИКОГДА не возвращать сам API-ключ — D-04/D-05.

import { ipcMain } from 'electron'
import {
  Channels,
  type PreferenceKey,
  type Result,
  type SecureBackend,
  type UserPreferences
} from '../../shared/ipc'
import { secretsStore } from '../services/secrets-store'
import { secureBackend } from '../services/secure-backend'
import { settingsStore, SETTINGS_DEFAULTS } from '../services/settings-store'

// Разрешённые к чтению/записи несекретные ключи (D-08/D-02). Renderer не может
// записать произвольный ключ — только эти три (V5 ASVS, валидация в main).
const PREFERENCE_KEYS = new Set<string>(['selectedModel', 'selectedLanguage', 'timecodesEnabled'])

export function registerSettingsHandlers(): void {
  ipcMain.handle(
    Channels.SETTINGS_SAVE_API_KEY,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const key = args[0]
        if (typeof key !== 'string') {
          return { ok: false, reason: 'invalid_argument' }
        }
        return await secretsStore.saveApiKey(key)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[ipc/settings] saveApiKey internal error:', err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  ipcMain.handle(Channels.SETTINGS_HAS_API_KEY, async (): Promise<Result<boolean>> => {
    try {
      return await secretsStore.hasApiKey()
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[ipc/settings] hasApiKey internal error:', err)
      return { ok: false, reason: 'internal' }
    }
  })

  ipcMain.handle(Channels.SETTINGS_CLEAR_API_KEY, async (): Promise<Result> => {
    try {
      return await secretsStore.clearApiKey()
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[ipc/settings] clearApiKey internal error:', err)
      return { ok: false, reason: 'internal' }
    }
  })

  ipcMain.handle(
    Channels.SETTINGS_GET_SECURE_BACKEND,
    async (): Promise<Result<SecureBackend>> => {
      try {
        return { ok: true, data: secureBackend.backend() }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[ipc/settings] getSecureBackend internal error:', err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // SETTINGS_GET_PREFERENCES — несекретные UI-настройки с дефолтами (D-08/D-02).
  ipcMain.handle(
    Channels.SETTINGS_GET_PREFERENCES,
    async (): Promise<Result<UserPreferences>> => {
      try {
        const prefs: UserPreferences = {
          selectedModel: settingsStore.get('selectedModel') ?? SETTINGS_DEFAULTS.selectedModel,
          selectedLanguage:
            settingsStore.get('selectedLanguage') ?? SETTINGS_DEFAULTS.selectedLanguage,
          timecodesEnabled:
            settingsStore.get('timecodesEnabled') ?? SETTINGS_DEFAULTS.timecodesEnabled
        }
        return { ok: true, data: prefs }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[ipc/settings] getPreferences internal error:', err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // SETTINGS_SET_PREFERENCE — записать одну несекретную настройку (whitelist ключей).
  ipcMain.handle(
    Channels.SETTINGS_SET_PREFERENCE,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const key = args[0]
        const value = args[1]
        if (typeof key !== 'string' || !PREFERENCE_KEYS.has(key)) {
          return { ok: false, reason: 'invalid_argument' }
        }
        if (key === 'timecodesEnabled') {
          if (typeof value !== 'boolean') return { ok: false, reason: 'invalid_argument' }
        } else if (typeof value !== 'string' || value.length === 0) {
          return { ok: false, reason: 'invalid_argument' }
        }
        settingsStore.set(key as PreferenceKey, value as never)
        return { ok: true }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[ipc/settings] setPreference internal error:', err)
        return { ok: false, reason: 'internal' }
      }
    }
  )
}
