import { getServerSession } from "next-auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CircleDot, Clock, MapPin, RotateCcw, X } from "lucide-react";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import { getDriverExpense } from "@/lib/expenseLedger";
import { formatDateOnly, formatKm } from "@/lib/incomeExpenseFormat";
import { LocalDateTime } from "@/components/LocalDateTime";
import { CategoryBadge, StatusPill, formatRupees } from "../../WalletUI";

export const dynamic = "force-dynamic";

function Step({
  icon: Icon,
  tone,
  title,
  at,
  detail,
  last,
}: {
  icon: typeof Check;
  tone: string;
  title: string;
  at?: string | null;
  detail?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-slate-700" />}
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-medium text-slate-100">{title}</p>
        {at && (
          <p className="text-xs text-slate-500">
            <LocalDateTime value={at} />
          </p>
        )}
        {detail && <div className="mt-0.5 text-xs text-slate-400">{detail}</div>}
      </div>
    </li>
  );
}

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  await connectToDatabase();

  const driver = await Driver.findOne({ userId: session?.user.id }).select("_id").lean();
  const e = driver ? await getDriverExpense(String(driver._id), id) : null;
  if (!e) notFound();

  const refunded = e.status === "rejected" && e.deductedOnSubmit;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/driver/history" className="-ml-2 rounded-full p-2 text-slate-400 hover:bg-slate-800" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-white">Expense details</h1>
      </div>

      <div className="flex flex-col items-center rounded-3xl border border-slate-800 bg-slate-900 px-5 py-7 text-center">
        <CategoryBadge category={e.category} size="lg" />
        <p className="mt-3 text-sm text-slate-400">{e.category}</p>
        <p
          className={`mt-1 text-4xl font-extrabold tracking-tight tabular-nums text-white ${
            e.status === "rejected" ? "line-through decoration-slate-500" : ""
          }`}
        >
          {formatRupees(e.amount)}
        </p>
        <p className="mt-2 max-w-xs text-sm text-slate-300">{e.description}</p>
        <div className="mt-3">
          <StatusPill expense={e} />
        </div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</h2>
        <ol>
          <Step
            icon={CircleDot}
            tone="bg-indigo-500/20 text-indigo-300"
            title={e.deductedOnSubmit ? "Submitted and deducted from wallet" : "Submitted"}
            at={e.submittedAt}
            detail={
              e.deductedOnSubmit && e.walletBalanceAfter !== null ? (
                <>
                  Wallet balance after:{" "}
                  <span className={e.walletBalanceAfter < 0 ? "font-semibold text-rose-400" : "font-semibold text-slate-200"}>
                    {formatRupees(e.walletBalanceAfter)}
                  </span>
                  {e.excessAmount > 0 && <span className="text-rose-300"> ({formatRupees(e.excessAmount)} beyond your balance)</span>}
                </>
              ) : null
            }
            last={false}
          />
          {e.status === "pending" && (
            <Step icon={Clock} tone="bg-amber-500/20 text-amber-300" title="Waiting for HR approval" last />
          )}
          {e.status === "approved" && (
            <Step
              icon={Check}
              tone="bg-emerald-500/20 text-emerald-300"
              title={`Approved${e.reviewedByName ? ` by ${e.reviewedByName}` : ""}`}
              at={e.reviewedAt}
              detail={
                !e.deductedOnSubmit && e.balanceAfterApproval !== null
                  ? `Deducted on approval. Balance after: ${formatRupees(e.balanceAfterApproval)}`
                  : null
              }
              last
            />
          )}
          {e.status === "rejected" && (
            <>
              <Step
                icon={X}
                tone="bg-rose-500/20 text-rose-300"
                title={`Rejected${e.reviewedByName ? ` by ${e.reviewedByName}` : ""}`}
                at={e.reviewedAt}
                detail={e.rejectionReason ? `Reason: ${e.rejectionReason}` : null}
                last={!refunded}
              />
              {refunded && (
                <Step
                  icon={RotateCcw}
                  tone="bg-teal-500/20 text-teal-300"
                  title={`${formatRupees(e.amount)} refunded to your wallet`}
                  at={e.reviewedAt}
                  last
                />
              )}
            </>
          )}
        </ol>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <h2 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Bill / receipt</h2>
        <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="block p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={e.receiptUrl}
            alt={`Receipt for ${formatRupees(e.amount)}`}
            className="max-h-[28rem] w-full rounded-xl border border-slate-800 bg-black object-contain"
          />
          <span className="mt-2 block text-center text-xs text-indigo-400">Tap to open full size</span>
        </a>
      </section>

      <dl className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900 text-sm">
        {e.vehicleRegistration && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-slate-400">Vehicle</dt>
            <dd className="text-slate-100">{e.vehicleRegistration}</dd>
          </div>
        )}
        {e.odometerKm != null && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-slate-400">Odometer</dt>
            <dd className="text-slate-100">{formatKm(e.odometerKm)}</dd>
          </div>
        )}
        {e.runKm != null && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-slate-400">This run</dt>
            <dd className="font-medium text-emerald-300">
              {formatKm(e.runKm)}
              {e.previousOdometerKm != null ? ` (${formatKm(e.previousOdometerKm)} → ${formatKm(e.odometerKm)})` : ""}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-400">Date of expense</dt>
          <dd className="text-slate-100">{formatDateOnly(e.expenseDate)}</dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-400">Submitted</dt>
          <dd className="text-slate-100">
            <LocalDateTime value={e.submittedAt} />
          </dd>
        </div>
        {e.location && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-slate-400">Location</dt>
            <dd>
              <a
                href={`https://maps.google.com/?q=${e.location.lat},${e.location.lng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                <MapPin className="h-3.5 w-3.5" /> View on map
              </a>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-400">Transaction ID</dt>
          <dd className="truncate font-mono text-xs text-slate-300">{e.id}</dd>
        </div>
      </dl>
    </div>
  );
}
