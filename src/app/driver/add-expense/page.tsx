"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, Image as ImageIcon, Loader2, MapPin, RotateCcw, X } from "lucide-react";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expenseMath";
import { formatKm } from "@/lib/incomeExpenseFormat";
import { CATEGORY_STYLE, formatRupees } from "../WalletUI";

type GpsState = "idle" | "warming" | "ready" | "denied" | "error";
type Fix = { lat: number; lng: number; acc: number };

interface SubmitResult {
  id: string;
  amount: number;
  balance: number;
  excessAmount: number;
  duplicate: boolean;
  runKm?: number | null;
  odometerKm?: number | null;
  vehicleRegistration?: string | null;
}

interface VehicleOption {
  id: string;
  registration: string;
  odometerKm: number | null;
}

/** Works on plain-http LAN addresses too, where crypto.randomUUID is unavailable. */
function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MAX_EDGE = 1600;

/** Downscale and JPEG-encode a photo so receipts stay legible but upload fast on mobile data. */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the photo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a photo we can read."));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.75;
        let out = canvas.toDataURL("image/jpeg", quality);
        while (out.length > 4_000_000 && quality > 0.3) {
          quality -= 0.15;
          out = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(out);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function AddExpensePage() {
  const router = useRouter();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const watchId = useRef<number | null>(null);
  const bestFix = useRef<Fix | null>(null);
  // One id per expense being entered: every retry of this submission reuses it,
  // so the server records (and deducts) it once however many times it arrives.
  const requestId = useRef<string>("");

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [gps, setGps] = useState<GpsState>("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<SubmitResult | null>(null);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGps("error");
      return;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    setGps("warming");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
        if (!bestFix.current || f.acc < bestFix.current.acc) {
          bestFix.current = f;
          setFix(f);
        }
        setGps("ready");
      },
      (err) => setGps(err.code === err.PERMISSION_DENIED ? "denied" : bestFix.current ? "ready" : "error"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 }
    );
  }, []);

  useEffect(() => {
    requestId.current = newRequestId();
    setExpenseDate(todayLocal());
    fetch("/api/driver/me/summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s) return;
        if (typeof s.walletBalance === "number") setBalance(s.walletBalance);
        if (Array.isArray(s.vehicles)) {
          setVehicles(s.vehicles);
          if (s.vehicles.length === 1) setVehicleId(s.vehicles[0].id);
        }
      })
      .catch(() => {});
    // Start location straight away when it is already allowed; otherwise wait for a tap.
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (p.state === "granted") startGps();
        if (p.state === "denied") setGps("denied");
      })
      .catch(() => {});
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [startGps]);

  const amountNum = Number.parseFloat(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const odometerNum = Number.parseFloat(odometer);
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const runPreview =
    category === "Fuel" &&
    selectedVehicle?.odometerKm != null &&
    Number.isFinite(odometerNum) &&
    odometerNum > selectedVehicle.odometerKm
      ? Math.round((odometerNum - selectedVehicle.odometerKm) * 10) / 10
      : null;
  const balanceAfter = balance !== null && validAmount ? Math.round((balance - amountNum) * 100) / 100 : null;

  function onAmountChange(v: string) {
    const cleaned = v.replace(/[^\d.]/g, "");
    if (/^\d{0,7}(\.\d{0,2})?$/.test(cleaned)) setAmount(cleaned);
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    if (!validAmount) return setError("Enter the amount you spent.");
    if (category === "Fuel") {
      if (!Number.isFinite(odometerNum) || odometerNum < 0) return setError("Enter the odometer reading in kilometers.");
      if (vehicles.length > 1 && !vehicleId) return setError("Choose the vehicle.");
      if (selectedVehicle?.odometerKm != null && odometerNum <= selectedVehicle.odometerKm) {
        return setError(`Odometer must be higher than the last reading (${formatKm(selectedVehicle.odometerKm)}).`);
      }
    }
    if (!expenseDate) return setError("Choose the date of the expense.");
    if (!photo) return setError("Take a photo of the bill or receipt.");
    if (!bestFix.current) {
      if (gps === "idle" || gps === "error") startGps();
      return setError("Waiting for your location. Keep Location on and try again in a moment.");
    }

    setError("");
    setSubmitting(true);
    const payload = JSON.stringify({
      amount: Math.round(amountNum * 100) / 100,
      category,
      description: description.trim(),
      expenseDate,
      photoBase64: photo,
      latitude: bestFix.current.lat,
      longitude: bestFix.current.lng,
      accuracy: bestFix.current.acc,
      clientRequestId: requestId.current,
      ...(category === "Fuel"
        ? { odometerKm: Math.round(odometerNum * 10) / 10, ...(vehicleId ? { vehicleId } : {}) }
        : {}),
    });

    // Retry on dropped connections and server hiccups with the same request id.
    let lastError = "Could not submit. Check your connection and try again.";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/driver/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setDone(body as SubmitResult);
          setSubmitting(false);
          return;
        }
        lastError = body.error || `Submission failed (${res.status}).`;
        if (res.status < 500) break;
      } catch {
        // Network failure: fall through and retry.
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    setError(lastError);
    setSubmitting(false);
  }

  if (done) {
    const negative = done.balance < 0;
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30" />
          <CheckCircle2 className="relative h-24 w-24 text-emerald-400" strokeWidth={1.5} />
        </div>
        <p className="mt-6 text-sm text-slate-400">{done.duplicate ? "Already recorded" : "Expense recorded"}</p>
        <p className="mt-1 text-5xl font-extrabold tracking-tight tabular-nums text-white">{formatRupees(done.amount)}</p>
        <p className="mt-2 text-sm text-slate-300">
          {[category ?? "Other", description.trim()].filter(Boolean).join(" · ")}
        </p>
        {done.runKm != null && (
          <p className="mt-2 text-sm font-medium text-emerald-300">
            {formatKm(done.runKm)} this run
            {done.vehicleRegistration ? ` · ${done.vehicleRegistration}` : ""}
          </p>
        )}
        {done.duplicate && (
          <p className="mt-3 max-w-xs text-xs text-amber-300">
            This expense had already reached the server, so it was not deducted a second time.
          </p>
        )}
        <div className="mt-8 w-full rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Wallet balance now</span>
            <span className={`font-semibold tabular-nums ${negative ? "text-rose-400" : "text-white"}`}>
              {formatRupees(done.balance)}
            </span>
          </div>
          {done.excessAmount > 0 && (
            <p className="mt-2 text-left text-xs text-rose-300">
              {formatRupees(done.excessAmount)} of this was more than your balance. It is recorded as owed to you.
            </p>
          )}
          <div className="mt-2 flex justify-between">
            <span className="text-slate-400">Status</span>
            <span className="text-amber-400">Awaiting HR approval</span>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <span className="text-slate-400">Transaction ID</span>
            <span className="truncate font-mono text-xs text-slate-300">{done.id}</span>
          </div>
        </div>
        <div className="mt-6 grid w-full grid-cols-2 gap-3">
          <Link
            href={`/driver/transactions/${done.id}`}
            className="rounded-xl border border-slate-700 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            View details
          </Link>
          <button
            onClick={() => {
              router.push("/driver/dashboard");
              router.refresh();
            }}
            className="rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-28">
      <div className="flex items-center gap-3">
        <Link href="/driver/dashboard" className="-ml-2 rounded-full p-2 text-slate-400 hover:bg-slate-800" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-white">Add expense</h1>
      </div>

      {/* Amount */}
      <div className="flex flex-col items-center pt-2">
        <label htmlFor="amount" className="text-sm text-slate-400">
          Amount spent
        </label>
        <div className="mt-2 flex items-baseline justify-center gap-1">
          <span className={`text-4xl font-bold ${amount ? "text-white" : "text-slate-600"}`}>₹</span>
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            className="bg-transparent text-center text-6xl font-extrabold tracking-tight text-white placeholder:text-slate-700 focus:outline-none"
            style={{ width: `${Math.max(1, amount.length || 1) + 0.5}ch` }}
          />
        </div>
        {balance !== null && (
          <p className="mt-3 rounded-full bg-slate-900 px-3 py-1 text-xs text-slate-400 ring-1 ring-slate-800">
            Wallet {formatRupees(balance)}
            {balanceAfter !== null && (
              <>
                {" → "}
                <span className={balanceAfter < 0 ? "font-semibold text-rose-400" : "font-semibold text-emerald-400"}>
                  {formatRupees(balanceAfter)}
                </span>
              </>
            )}
          </p>
        )}
        {balanceAfter !== null && balanceAfter < 0 && (
          <p className="mt-2 max-w-xs text-center text-xs text-amber-300">
            This takes your wallet below zero. You can still submit it; the extra is recorded as owed to you.
          </p>
        )}
      </div>

      {/* Category */}
      <div>
        <p className="mb-2 px-1 text-sm font-medium text-slate-300">
          Category <span className="font-normal text-slate-500">(optional)</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {EXPENSE_CATEGORIES.map((c) => {
            const s = CATEGORY_STYLE[c];
            const Icon = s.icon;
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(active ? null : c)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-medium ring-1 transition-colors ${
                  active ? "bg-indigo-500/15 text-white ring-indigo-400" : "bg-slate-900 text-slate-300 ring-slate-800 hover:bg-slate-800"
                }`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-full ${s.tone}`}>
                  <Icon className="h-5 w-5" />
                </span>
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {category === "Fuel" && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <p className="text-sm font-medium text-slate-300">Odometer</p>
            <p className="mt-0.5 text-xs text-slate-500">The reading on the vehicle at this petrol fill. The difference is the kilometers of the run.</p>
          </div>
          {vehicles.length > 1 && (
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 focus:border-indigo-400 focus:outline-none"
            >
              <option value="">Choose vehicle</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration}
                  {v.odometerKm != null ? ` · ${formatKm(v.odometerKm)}` : ""}
                </option>
              ))}
            </select>
          )}
          {vehicles.length === 1 && (
            <p className="text-sm text-slate-300">
              {vehicles[0].registration}
              {vehicles[0].odometerKm != null ? ` · last reading ${formatKm(vehicles[0].odometerKm)}` : ""}
            </p>
          )}
          <input
            inputMode="decimal"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="Current reading (km)"
            className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none"
          />
          {selectedVehicle && selectedVehicle.odometerKm != null && vehicles.length !== 1 && (
            <p className="text-xs text-slate-400">Last reading {formatKm(selectedVehicle.odometerKm)}</p>
          )}
          {runPreview != null && (
            <p className="text-sm font-semibold text-emerald-400">This run {formatKm(runPreview)}</p>
          )}
        </div>
      )}

      {/* Receipt */}
      <div>
        <p className="mb-2 px-1 text-sm font-medium text-slate-300">Bill or receipt photo</p>
        {photo ? (
          <div className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Receipt preview" className="max-h-72 w-full object-contain" />
            <div className="absolute right-2 top-2 flex gap-2">
              <button
                type="button"
                onClick={() => cameraInput.current?.click()}
                className="flex items-center gap-1 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Retake
              </button>
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label="Remove photo"
                className="rounded-full bg-slate-950/80 p-1.5 text-white backdrop-blur"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraInput.current?.click()}
              disabled={photoBusy}
              className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-indigo-500/50 bg-indigo-500/5 text-indigo-200 hover:bg-indigo-500/10"
            >
              {photoBusy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
              <span className="text-sm font-semibold">Take photo</span>
            </button>
            <button
              type="button"
              onClick={() => galleryInput.current?.click()}
              disabled={photoBusy}
              className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            >
              <ImageIcon className="h-7 w-7" />
              <span className="text-sm font-semibold">From gallery</span>
            </button>
          </div>
        )}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={onPhotoPicked} className="hidden" />
        <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhotoPicked} className="hidden" />
      </div>

      {/* Details */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-1.5">
          <label htmlFor="desc" className="text-sm font-medium text-slate-300">
            What was it for? <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="desc"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Diesel at Shell pump, NH48"
            className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="date" className="text-sm font-medium text-slate-300">
            Date of expense
          </label>
          <input
            id="date"
            type="date"
            value={expenseDate}
            max={todayLocal()}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 [color-scheme:dark] focus:border-indigo-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Location */}
      <button
        type="button"
        onClick={() => gps !== "ready" && gps !== "warming" && startGps()}
        className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left text-sm ${
          gps === "ready" ? "border-slate-800 bg-slate-900" : "border-amber-500/40 bg-amber-500/5"
        }`}
      >
        <MapPin
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            gps === "ready" ? "text-emerald-400" : gps === "warming" ? "animate-pulse text-amber-400" : "text-amber-400"
          }`}
        />
        <span>
          {gps === "ready" && fix ? (
            <span className="text-slate-200">Location captured (±{Math.round(fix.acc)} m)</span>
          ) : gps === "warming" ? (
            <span className="text-amber-300">Getting your location…</span>
          ) : gps === "denied" ? (
            <span className="text-amber-200">
              Location is blocked for this page. Tap the lock icon in the address bar → Site settings → Location → Allow, then tap
              here.
            </span>
          ) : (
            <span className="text-amber-200">Tap to add your location (required for every expense)</span>
          )}
        </span>
      </button>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || photoBusy}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-emerald-600 text-lg font-bold text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Recording…
              </>
            ) : validAmount ? (
              `Record ${formatRupees(amountNum)}`
            ) : (
              "Record expense"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
