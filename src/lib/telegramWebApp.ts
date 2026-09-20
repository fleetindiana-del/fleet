import { createHmac, timingSafeEqual } from "crypto";

/**
 * Validates the signed initData string Telegram injects into a Web App.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowMs = Date.now()
): { userId: string } | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]+$/i.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const left = Buffer.from(calculated, "hex");
  const right = Buffer.from(hash, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (nowMs / 1000 - authDate > 24 * 60 * 60) return null;

  let user: { id?: number | string };
  try {
    user = JSON.parse(params.get("user") || "");
  } catch {
    return null;
  }
  if (user?.id === undefined || user.id === null || user.id === "") return null;
  return { userId: String(user.id) };
}
