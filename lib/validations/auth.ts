import { z } from "zod";

export const magicLinkSchema = z.object({
  email: z.email().max(320),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;

/**
 * `next` viaja en la URL, así que llega desde afuera. Solo se acepta una ruta
 * interna del panel: cualquier otra cosa (URL absoluta, `//host`) se descarta.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/admin";
  if (!value.startsWith("/admin")) return "/admin";
  if (value.startsWith("//")) return "/admin";
  return value;
}
