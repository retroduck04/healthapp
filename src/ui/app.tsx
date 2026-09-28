// App shell: MAGI header (brand, process state, Garmin link lamp, CONFIG), the numbered key strip
// for the five tabs, sheets, notices, automatic Garmin sync and the update notice.

import { useEffect, useRef, useState } from "react";
import { useLive } from "../db/db";
import { getGarminKey, getGarminStatus, syncGarmin, type GarminStatus } from "../db/garmin";
import { activeWorkout, ensureSeeded, getSettings } from "../db/repo";
import { defaultSettings, type Workout } from "../db/types";
import { FoodAddSheet, FoodScreen } from "./food";
import { garminLink, garminMessageCode, UIContext, type SheetRequest, type Tab, type UI } from "./kit";
import { runWeeklyCheckIn } from "./models";
import { alertBand, AlertBand } from "./raster";
import { ProgressScreen } from "./progress";
import { CaffeineSheet, CheckInSheet, QuickSheet, SettingsSheet, WeightSheet } from "./sheets";
import { SleepScreen } from "./sleep";
import { TodayScreen } from "./today";
import { CardioSheet, TrainScreen } from "./train";

const TABS: { id: Tab; no: string; label: string }[] = [
  { id: "today", no: "01", label: "TODAY" },
  { id: "food", no: "02", label: "FOOD" },
  { id: "train", no: "03", label: "TRAIN" },
  { id: "sleep", no: "04", label: "SLEEP" },
  { id: "progress", no: "05", label: "PROGRESS" },
];

function initialTab(): Tab {
  try {
    const t = localStorage.getItem("janos.tab") as Tab | null;
    return t && TABS.some((x) => x.id === t) ? t : "today";
  } catch {
    return "today";
  }
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

export function App() {
  const settings = useLive(getSettings, [], defaultSettings);
  const running = useLive(activeWorkout, [], null as Workout | null);
  const garminKey = useLive(getGarminKey, [], null as string | null);
  const garminStatus = useLive(getGarminStatus, [], null as GarminStatus | null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => void; id: number } | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    void ensureSeeded();
    const sync = () => {
      if (document.visibilityState === "visible") void syncGarmin();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("janos-update", onUpdate);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("janos-update", onUpdate);
    };
  }, []);

  // Garmin key mismatch is one of the three alarm moments: raise the alert band once per failed sync.
  const alarmedAttempt = useRef<number | null>(null);
  useEffect(() => {
    const code = garminMessageCode(garminStatus?.message);
    if (code?.startsWith("ERR 001") && garminStatus?.lastAttempt && alarmedAttempt.current !== garminStatus.lastAttempt) {
      alarmedAttempt.current = garminStatus.lastAttempt;
      alertBand("ERR 001 GARMIN LINK KEY MISMATCH · DATA CANNOT BE DECRYPTED");
    }
  }, [garminStatus?.message, garminStatus?.lastAttempt]);

  // Weekly check-in: targets follow the adaptive expenditure estimate (runs on open and when goals change).
  const goalSig = `${settings.autoTargets}|${settings.phase}|${settings.goalRatePct}|${settings.proteinTarget}`;
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible") return;
      void getSettings().then(async (s) => {
        const rec = await runWeeklyCheckIn(s);
        if (rec) ui.toast(`>> 096 WEEKLY CHECK-IN · TARGET ${rec.kcal} KCAL · ${rec.proteinG} G PROTEIN`);
      });
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalSig]);

  // [U] applies a waiting update (when no field has focus and no screen is open).
  useEffect(() => {
    if (!updateReady) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "u" || e.key === "U") && !typing(e.target) && !document.querySelector(".mg-screen")) window.dispatchEvent(new Event("janos-apply-update"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [updateReady]);

  const goTab = (t: Tab) => {
    setTab(t);
    setSheet(null);
    window.scrollTo(0, 0);
    try {
      localStorage.setItem("janos.tab", t);
    } catch {
      /* private mode */
    }
  };

  const dismissToast = () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(null);
  };

  const ui: UI = {
    settings,
    tab,
    goTab,
    open: setSheet,
    close: () => setSheet(null),
    toast: (message, undo) => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      setToast({ message, undo, id: Date.now() });
      toastTimer.current = window.setTimeout(() => setToast(null), undo ? 5000 : /^ERR/.test(message) ? 4000 : 2500);
    },
  };

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const link = garminLink(garminKey, garminStatus);

  return (
    <UIContext.Provider value={ui}>
      <header className="mg-hdr app-hdr">
        <div className="hdr-in">
          <div className="mg-brand" aria-label="Janos">
            <span className="mg-mx">JANOS</span>
          </div>
          <div className={running ? "mg-proc run" : "mg-proc"} role="status" aria-label={`Current process state: ${active.label}${running ? ", workout in progress" : ""}`}>
            <small>CURRENT PROCESS STATE</small>
            <span>
              <b>{active.no}</b>
              {active.label}
            </span>
          </div>
          <button
            type="button"
            className={`mg-lamp ${link.lamp}`}
            aria-label={`Garmin link ${link.label}${link.code ? `: ${link.code}` : ""}. Open config.`}
            onClick={() => setSheet({ kind: "settings" })}
          >
            <i aria-hidden="true" />
            <span>{link.label}</span>
          </button>
          <button type="button" className="mg-key cfg" onClick={() => setSheet({ kind: "settings" })}>
            CONFIG
          </button>
        </div>
      </header>

      <main className="app">
        {tab === "today" ? <TodayScreen /> : null}
        {tab === "food" ? <FoodScreen /> : null}
        {tab === "train" ? <TrainScreen /> : null}
        {tab === "sleep" ? <SleepScreen /> : null}
        {tab === "progress" ? <ProgressScreen /> : null}
      </main>

      {tab !== "train" ? (
        <button type="button" className="fab" aria-label="log something" onClick={() => setSheet({ kind: "quick" })}>
          [+] LOG
        </button>
      ) : null}

      <nav className="tabbar" aria-label="Process state">
        <div className="tabbar-in">
          {TABS.map((t) => (
            <button type="button" key={t.id} className={t.id === tab ? "on" : ""} aria-current={t.id === tab ? "page" : undefined} onClick={() => goTab(t.id)}>
              <b>{t.no}</b>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <AlertBand />

      {sheet?.kind === "quick" ? <QuickSheet /> : null}
      {sheet?.kind === "weight" ? <WeightSheet /> : null}
      {sheet?.kind === "checkin" ? <CheckInSheet day={sheet.day} /> : null}
      {sheet?.kind === "caffeine" ? <CaffeineSheet /> : null}
      {sheet?.kind === "cardio" ? <CardioSheet id={sheet.id} /> : null}
      {sheet?.kind === "settings" ? <SettingsSheet /> : null}
      {sheet?.kind === "food" ? <FoodAddSheet day={sheet.day} meal={sheet.meal} /> : null}

      {updateReady || toast ? (
        <div className="notice-stack">
          {updateReady ? (
            <div className="mg-notice static">
              <span className="msg">NEW VERSION READY</span>
              <button type="button" className="mg-key x" onClick={() => window.dispatchEvent(new Event("janos-apply-update"))}>
                [U] UPDATE
              </button>
            </div>
          ) : null}
          {toast ? (
            <div className={/^ERR/.test(toast.message) ? "mg-notice static err toast" : "mg-notice static toast"} key={toast.id} role="status">
              <span className="msg">{toast.message}</span>
              {toast.undo ? (
                <button
                  type="button"
                  className="mg-key x"
                  onClick={() => {
                    toast.undo?.();
                    dismissToast();
                  }}
                >
                  [UNDO]
                </button>
              ) : null}
              <button type="button" className={toast.undo ? "mg-key" : "mg-key x"} aria-label="dismiss" onClick={dismissToast}>
                [X]
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </UIContext.Provider>
  );
}
