"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function EnterNameForm() {
  const searchParams = useSearchParams();
  const p = searchParams.get("p") ?? "";
  const e = searchParams.get("e") ?? "";
  const c = searchParams.get("c") ?? "";
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => {
      const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const contactName = name.trim();
    if (!contactName) {
      setErrorMsg("Please enter a name.");
      return;
    }
    if (!p || !e || !c) {
      setErrorMsg("Invalid link. Open from Telegram.");
      return;
    }
    setStatus("sending");
    setErrorMsg("");
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${base}/api/telegram/submit-scenario-b-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName,
          phoneNumber: p,
          employeeName: e,
          chatId: c,
          initData: (window as any).Telegram?.WebApp?.initData || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data?.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("done");
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.close) tg.close();
    } catch {
      setErrorMsg("Network error. Try again.");
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--tg-theme-bg-color,#fff)] text-[var(--tg-theme-text-color,#000)] p-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-2">Enter contact name</h1>
        <p className="text-sm opacity-80 mb-1">
          This number appeared 5+ times in your call logs. Who is it?
        </p>
        {p && (
          <p className="text-sm font-medium mb-4 text-[var(--tg-theme-link-color,#2481cc)]">
            Number: {p}
          </p>
        )}
        {!p && <div className="mb-4" />}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. John Doe"
            className="w-full px-4 py-3 rounded-lg border border-[var(--tg-theme-hint-color,#999)] bg-[var(--tg-theme-bg-color,#fff)] text-[var(--tg-theme-text-color,#000)] placeholder-[var(--tg-theme-hint-color,#999)]"
            autoFocus
            disabled={status === "sending" || status === "done"}
          />
          {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full py-3 rounded-lg font-medium text-white bg-[var(--tg-theme-button-color,#2481cc)] disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : status === "done" ? "Done" : "Submit"}
          </button>
        </form>
        <p className="text-xs opacity-70 mt-4 text-center">
          Or reply to the bot message in the chat with the name.
        </p>
      </div>
    </div>
  );
}

export default function EnterNamePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <EnterNameForm />
    </Suspense>
  );
}
