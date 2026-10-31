import { redirect } from "next/navigation";

/**
 * The shift list duplicated Tracking Alerts (live status, history, and the same
 * shift detail). The phone and alert APIs are unchanged; this address only
 * forwards old links.
 */
export default function ShiftsPage() {
  redirect("/tracking-alerts");
}
