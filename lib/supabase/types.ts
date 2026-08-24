/**
 * Atajos sobre los tipos generados.
 *
 * Viven aquí y no en `database.types.ts` porque ese archivo lo sobrescribe
 * `npm run gen:types` cada vez que cambia el esquema.
 */
import type { Database } from "./database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
