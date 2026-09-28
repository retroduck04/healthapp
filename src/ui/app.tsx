// App shell: tabs, sheets, toasts, automatic Garmin sync and the update banner.

import { useEffect, useRef, useState } from "react";
import { useLive } from "../db/db";
import { syncGarmin } from "../db/garmin";
import { ensureSeeded, getSettings } from "../db/repo";
import { defaultSettings } from "../db/types";
import { FoodAddSheet, FoodScreen } from "./food";
import { Icons, UIContext, type SheetRequest, type Tab, type UI } from "./kit";
import { ProgressScreen } from "./progress";
import { CaffeineSheet, CheckInSheet, QuickSheet, SettingsSheet, WeightSheet } from "./sheets";
import { SleepScreen } from "./sleep";
import { TodayScreen } from "./today";
import { CardioSheet, TrainScreen } from "./train";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "today", label: "Today", icon: Icons.today },
  { id: "food", label: "Food", icon: Icons.food },
  { id: "train", label: "Train", icon: Icons.train },
  { id: "sleep", label: "Sleep", icon: Icons.sleep },
  { id: "progress", label: "Progress", icon: Icons.progress },
];

function initialTab(): Tab {
  try {
    const t = localStorage.getItem("janos.tab") as Tab | null;
    return t && TABS.some((x) => x.id === t) ? t : "today";
  } catch {
    return "today";
  }
}

export function App() {
  const settings = useLive(getSettings, [], defaultSettings);
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

  const ui: UI = {
    settings,
    tab,
    goTab,
    open: setSheet,
    close: () => setSheet(null),
    toast: (message, undo) => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      setToast({ message, undo, id: Date.now() });
      toastTimer.current = window.setTimeout(() => setToast(null), undo ? 5000 : 2500);
    },
  };

  return (
    <UIContext.Provider value={ui}>
      <div className="app">
        {tab === "today" ? <TodayScreen /> : null}
        {tab === "food" ? <FoodScreen /> : null}
        {tab === "train" ? <TrainScreen /> : null}
        {tab === "sleep" ? <SleepScreen /> : null}
        {tab === "progress" ? <ProgressScreen /> : null}
      </div>

      {tab !== "train" ? (
        <button className="fab" aria-label="log something" onClick={() => setSheet({ kind: "quick" })}>
          +
        </button>
      ) : null}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? "on" : ""} onClick={() => goTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {sheet?.kind === "quick" ? <QuickSheet /> : null}
      {sheet?.kind === "weight" ? <WeightSheet /> : null}
      {sheet?.kind === "checkin" ? <CheckInSheet day={sheet.day} /> : null}
      {sheet?.kind === "caffeine" ? <CaffeineSheet /> : null}
      {sheet?.kind === "cardio" ? <CardioSheet id={sheet.id} /> : null}
      {sheet?.kind === "settings" ? <SettingsSheet /> : null}
      {sheet?.kind === "food" ? <FoodAddSheet day={sheet.day} meal={sheet.meal} /> : null}

      {toast ? (
        <div className="toast" key={toast.id} role="status">
          <span className="grow">{toast.message}</span>
          {toast.undo ? (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      {updateReady ? (
        <div className="toast" style={{ bottom: "auto", top: "calc(env(safe-area-inset-top) + 8px)" }}>
          <span className="grow">A new version is ready.</span>
          <button onClick={() => window.dispatchEvent(new Event("janos-apply-update"))}>Update</button>
        </div>
      ) : null}
    </UIContext.Provider>
  );
}
