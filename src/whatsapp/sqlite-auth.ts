import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from 'baileys';
import { Database } from '../db/database.js';

export function useSqliteAuthState(db: Database): {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
} {
  const row = db.get<{ value_json: string }>(
    'SELECT value_json FROM auth_creds WHERE singleton = 1',
  );
  const creds: AuthenticationCreds = row
    ? (JSON.parse(row.value_json, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: Partial<Record<string, SignalDataTypeMap[T]>> = {};
        const statement = db.raw.prepare(
          'SELECT value_json FROM auth_keys WHERE category = ? AND key_id = ?',
        );
        for (const id of ids) {
          const keyRow = statement.get(type, id) as { value_json: string } | undefined;
          if (!keyRow) continue;
          let value = JSON.parse(keyRow.value_json, BufferJSON.reviver) as SignalDataTypeMap[T];
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as proto.Message.IAppStateSyncKeyData,
            ) as unknown as SignalDataTypeMap[T];
          }
          result[id] = value;
        }
        return result as Record<string, SignalDataTypeMap[T]>;
      },
      set: async (data: SignalDataSet) => {
        db.transaction(() => {
          const upsert = db.raw.prepare(
            `INSERT INTO auth_keys(category, key_id, value_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(category, key_id) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = excluded.updated_at`,
          );
          const remove = db.raw.prepare(
            'DELETE FROM auth_keys WHERE category = ? AND key_id = ?',
          );
          const now = Date.now();
          for (const [category, values] of Object.entries(data)) {
            if (!values) continue;
            for (const [id, value] of Object.entries(values)) {
              if (value === null || value === undefined) {
                remove.run(category, id);
              } else {
                upsert.run(category, id, JSON.stringify(value, BufferJSON.replacer), now);
              }
            }
          }
        });
      },
      clear: async () => {
        db.run('DELETE FROM auth_keys');
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      db.run(
        `INSERT INTO auth_creds(singleton, value_json, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
        [JSON.stringify(creds, BufferJSON.replacer), Date.now()],
      );
    },
  };
}
