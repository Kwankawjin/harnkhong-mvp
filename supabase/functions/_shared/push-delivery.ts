// Deliver one notification to every device of a user and keep push_subscriptions tidy.
// Shared by the `push` function (test sends) and the payment-reminder job (PHASE 3).
import { sendWebPush, type PushOptions, type VapidKeys } from "./webpush.ts";

export type PushMessage = { title: string; body: string; url: string; tag?: string };
export type DeliveryReport = { devices: number; sent: number; failed: number; removed: number };

/** Remove a device after this many failed sends in a row (expired or broken subscription). */
const MAX_FAILURES = 10;

export function vapidFromEnv(env: { get(name: string): string | undefined }): VapidKeys | null {
  const publicKey = env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = env.get("VAPID_PRIVATE_KEY")?.trim();
  const subject = env.get("VAPID_SUBJECT")?.trim() || "mailto:harnkhong@gmail.com";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

/** Only same-site paths are allowed as the page a notification opens. */
export function safePath(url: string): string {
  return typeof url === "string" && /^\/(?!\/)[^\s\\]*$/.test(url) ? url : "/notifications";
}

export async function deliverToUser(
  db: any,
  userId: string,
  message: PushMessage,
  vapid: VapidKeys,
  options: PushOptions = {},
): Promise<DeliveryReport> {
  const { data: devices, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId);
  if (error) throw error;
  const report: DeliveryReport = { devices: devices?.length || 0, sent: 0, failed: 0, removed: 0 };
  const payload = { ...message, url: safePath(message.url) };

  for (const device of devices || []) {
    try {
      const result = await sendWebPush(device, payload, vapid, options);
      if (result.ok) {
        report.sent += 1;
        await db.from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", device.id);
        continue;
      }
      report.failed += 1;
      if (result.gone || device.failure_count + 1 >= MAX_FAILURES) {
        report.removed += 1;
        await db.from("push_subscriptions").delete().eq("id", device.id);
      } else {
        await db.from("push_subscriptions").update({ failure_count: device.failure_count + 1 }).eq("id", device.id);
      }
      console.warn("push_failed", { device: device.id, status: result.status, body: result.body });
    } catch (err) {
      report.failed += 1;
      console.error("push_error", { device: device.id, error: String((err as Error)?.message || err) });
    }
  }
  return report;
}
