"""Janos Health — Garmin Connect sync (runs on GitHub Actions).

Logs into Garmin Connect with the unofficial python-garminconnect library, downloads recent
days, and writes them into docs/data as AES-256-GCM encrypted, gzip-compressed JSON.
Only the Janos Health app on your phone holds the key (JANOS_DATA_KEY) to read them.

Environment:
  GARMIN_TOKENS                   login tokens from tools/Connect Garmin.bat (GitHub secret; preferred)
  GARMIN_EMAIL, GARMIN_PASSWORD   Garmin Connect login (GitHub secrets; fallback only)
  JANOS_DATA_KEY                  base64 32-byte key created in the app (GitHub secret)
  JANOS_DAYS_BACK                 days to refresh each run (default 4)
  JANOS_BACKFILL_DAYS             extra history to fetch this run (default 0; 60 on first run)
"""

from __future__ import annotations

import base64
import datetime as dt
import gzip
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
RAW = DATA / "raw"
SUMMARY = DATA / "summary.enc"
TOKENS = ROOT / "sync" / "tokens.enc"
AAD = b"janos-v1"
PAUSE = float(os.environ.get("JANOS_PAUSE", "0.6"))  # seconds between API calls, to stay gentle


# ---------------------------------------------------------------- encryption

def load_key() -> bytes:
    raw = os.environ.get("JANOS_DATA_KEY", "").strip()
    try:
        key = base64.b64decode(raw)
    except Exception:
        key = b""
    if len(key) != 32:
        sys.exit("JANOS_DATA_KEY is missing or not a 32-byte base64 key. Create it in the app: Settings → Garmin sync.")
    return key


def encrypt(key: bytes, obj: Any) -> bytes:
    plain = gzip.compress(json.dumps(obj, separators=(",", ":"), default=str).encode("utf-8"), mtime=0)
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plain, AAD)


def decrypt(key: bytes, blob: bytes) -> Any:
    plain = AESGCM(key).decrypt(blob[:12], blob[12:], AAD)
    return json.loads(gzip.decompress(plain).decode("utf-8"))


# ---------------------------------------------------------------- extraction

def g(obj: Any, *path: Any) -> Any:
    """Safe nested get: g(d, 'a', 0, 'b') returns None when anything is missing."""
    for p in path:
        if obj is None:
            return None
        try:
            obj = obj[p]
        except (KeyError, IndexError, TypeError):
            return None
    return obj


def first(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def summarize_day(day: str, raw: dict[str, Any]) -> dict[str, Any]:
    stats = raw.get("stats") or {}
    sleep = g(raw, "sleep", "dailySleepDTO") or {}
    hrv = g(raw, "hrv", "hrvSummary") or {}
    readiness = raw.get("training_readiness")
    if isinstance(readiness, list):
        readiness = readiness[0] if readiness else None
    maxm = raw.get("max_metrics")
    if isinstance(maxm, list):
        maxm = maxm[0] if maxm else None
    return {
        "date": day,
        "sleep": {
            "start": sleep.get("sleepStartTimestampGMT"),
            "end": sleep.get("sleepEndTimestampGMT"),
            "totalSec": sleep.get("sleepTimeSeconds"),
            "deepSec": sleep.get("deepSleepSeconds"),
            "lightSec": sleep.get("lightSleepSeconds"),
            "remSec": sleep.get("remSleepSeconds"),
            "awakeSec": sleep.get("awakeSleepSeconds"),
            "napSec": sleep.get("napTimeSeconds"),
            "score": g(sleep, "sleepScores", "overall", "value"),
            "respiration": sleep.get("averageRespirationValue"),
        },
        "hrv": {
            "lastNight": hrv.get("lastNightAvg"),
            "weeklyAvg": hrv.get("weeklyAvg"),
            "status": hrv.get("status"),
            "baselineLow": g(hrv, "baseline", "balancedLow"),
            "baselineHigh": g(hrv, "baseline", "balancedUpper"),
        },
        "restingHR": first(stats.get("restingHeartRate"), g(raw, "rhr", "allMetrics", "metricsMap", "WELLNESS_RESTING_HEART_RATE", 0, "value")),
        "steps": stats.get("totalSteps"),
        "activeKcal": stats.get("activeKilocalories"),
        "restingKcal": stats.get("bmrKilocalories"),
        "totalKcal": stats.get("totalKilocalories"),
        "stressAvg": stats.get("averageStressLevel"),
        "bodyBatteryHigh": stats.get("bodyBatteryHighestValue"),
        "bodyBatteryLow": stats.get("bodyBatteryLowestValue"),
        "bodyBatteryWake": stats.get("bodyBatteryAtWakeTime"),
        "moderateMin": stats.get("moderateIntensityMinutes"),
        "vigorousMin": stats.get("vigorousIntensityMinutes"),
        "floors": stats.get("floorsAscended"),
        "vo2max": first(g(maxm, "generic", "vo2MaxPreciseValue"), g(maxm, "generic", "vo2MaxValue")),
        "readiness": g(readiness, "score"),
    }


def summarize_activity(a: dict[str, Any]) -> dict[str, Any]:
    zones = [a.get(f"hrTimeInZone_{i}") for i in range(1, 6)]
    return {
        "id": a.get("activityId"),
        "name": a.get("activityName"),
        "type": g(a, "activityType", "typeKey"),
        "startGMT": a.get("startTimeGMT"),
        "startLocal": a.get("startTimeLocal"),
        "durationSec": a.get("duration"),
        "movingSec": a.get("movingDuration"),
        "distanceM": a.get("distance"),
        "avgHR": a.get("averageHR"),
        "maxHR": a.get("maxHR"),
        "kcal": a.get("calories"),
        "avgSpeed": a.get("averageSpeed"),
        "elevGain": a.get("elevationGain"),
        "aerobicTE": a.get("aerobicTrainingEffect"),
        "anaerobicTE": a.get("anaerobicTrainingEffect"),
        "zonesSec": zones if any(z is not None for z in zones) else None,
        "trainingLoad": a.get("activityTrainingLoad"),
    }


def summarize_weights(body: Any) -> list[dict[str, Any]]:
    out = []
    for w in g(body, "dateWeightList") or []:
        grams = w.get("weight")
        ts = first(w.get("timestampGMT"), w.get("date"))
        if grams and ts:
            out.append({"t": ts, "kg": grams / 1000.0, "sourceType": w.get("sourceType")})
    return out


# ---------------------------------------------------------------- garmin

def login(email: str, password: str, home: Path, key: bytes):
    """Logs in with saved tokens when possible, so GitHub never has to send the password to Garmin.

    Order: tokens saved by earlier runs (sync/tokens.enc), then the GARMIN_TOKENS secret made by
    tools/Connect Garmin.bat on your own computer, then email + password as a last resort.
    Garmin often rate-limits password logins from GitHub's servers (HTTP 429); token logins avoid that.
    """
    from garminconnect import Garmin  # imported here so the rest can be tested without it

    token_dir = home / ".garminconnect"
    errors: list[str] = []
    sources = (("saved tokens", lambda: restore_tokens(key, home)), ("GARMIN_TOKENS secret", lambda: seed_tokens(home)))
    for label, load in sources:
        clear_tokens(home)
        if not load():
            continue
        try:
            api = Garmin()  # no password: if the tokens are bad this fails instead of trying a password login
            api.login(str(token_dir))
            print(f"Logged in to Garmin with {label}.")
            return api
        except Exception as e:  # noqa: BLE001
            errors.append(f"{label}: {type(e).__name__}: {str(e)[:200]}")

    if email and password:
        clear_tokens(home)
        token_dir.mkdir(parents=True, exist_ok=True)
        try:
            api = Garmin(email, password)
            api.login(str(token_dir))
            print("Logged in to Garmin with email and password.")
            return api
        except Exception as e:  # noqa: BLE001
            errors.append(f"password login: {type(e).__name__}: {str(e)[:200]}")

    text = " | ".join(errors) or "no tokens and no password"
    if "429" in text or "TooManyRequests" in text:
        hint = ("Garmin is blocking logins from GitHub's servers. Fix: on your laptop, double-click "
                "tools/Connect Garmin.bat, then save what it copies as the GitHub secret GARMIN_TOKENS.")
    else:
        hint = ("Check the GARMIN_EMAIL and GARMIN_PASSWORD secrets, or run tools/Connect Garmin.bat on your "
                "laptop and save what it copies as the GitHub secret GARMIN_TOKENS.")
    sys.exit(f"Garmin login failed: {text}\n\n{hint}")


TOKEN_DIRS = ("tokens", ".garminconnect", ".garth")


def save_tokens(api: Any, key: bytes, token_dir: Path, home: Path) -> None:
    """Saves the library's login tokens (encrypted) so later runs rarely need the password."""
    for holder in ("client", "garth"):  # 0.3.x keeps tokens on api.client, older versions on api.garth
        try:
            dump = getattr(getattr(api, holder, None), "dump", None)
            if callable(dump):
                dump(str(token_dir))
                break
        except Exception:  # noqa: BLE001
            pass
    files = {}
    for name in TOKEN_DIRS:
        base = home / name
        if base.is_dir():
            for f in base.rglob("*"):
                if f.is_file():
                    files[str(f.relative_to(home))] = base64.b64encode(f.read_bytes()).decode()
    if files:
        TOKENS.write_bytes(encrypt(key, files))


def write_token_files(home: Path, files: dict[str, str]) -> int:
    written = 0
    for rel, b64 in files.items():
        rel = rel.replace("\\", "/")
        if rel.split("/")[0] not in TOKEN_DIRS or ".." in rel:
            continue
        target = home / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(b64))
        written += 1
    return written


def clear_tokens(home: Path) -> None:
    for name in TOKEN_DIRS:
        shutil.rmtree(home / name, ignore_errors=True)


def restore_tokens(key: bytes, home: Path) -> bool:
    """Tokens saved (encrypted) by the previous run."""
    if not TOKENS.exists():
        return False
    try:
        files = decrypt(key, TOKENS.read_bytes())
    except Exception:  # noqa: BLE001
        print("Saved Garmin tokens could not be decrypted (new key?). Skipping them.")
        return False
    return write_token_files(home, files) > 0


def seed_tokens(home: Path) -> bool:
    """Tokens from the GARMIN_TOKENS secret (made by tools/Connect Garmin.bat on your own computer)."""
    raw = os.environ.get("GARMIN_TOKENS", "").strip()
    if not raw:
        return False
    try:
        files = json.loads(base64.b64decode(raw))
    except Exception:  # noqa: BLE001
        print("The GARMIN_TOKENS secret isn't in the expected format. Run tools/Connect Garmin.bat again and paste the new value.")
        return False
    return write_token_files(home, files) > 0


def call(errors: list[str], label: str, fn: Callable[[], Any]) -> Any:
    try:
        result = fn()
        time.sleep(PAUSE)
        return result
    except Exception as e:  # noqa: BLE001
        errors.append(f"{label}: {type(e).__name__}: {str(e)[:200]}")
        time.sleep(PAUSE)
        return None


def fetch_activities(api: Any, start: str, end: str, errors: list[str]) -> list[dict[str, Any]]:
    """Activities with a local start date in [start, end]."""
    if hasattr(api, "get_activities_by_date"):
        found = call(errors, "activities", lambda: api.get_activities_by_date(start, end))
    else:  # page back through the newest activities until we pass the start date
        found = []
        for page in range(20):
            batch = call(errors, "activities", lambda: api.get_activities(page * 50, 50))
            if not isinstance(batch, list) or not batch:
                break
            found.extend(batch)
            oldest = min(str(a.get("startTimeLocal") or "")[:10] for a in batch)
            if oldest < start or len(batch) < 50:
                break
    return [a for a in found or [] if isinstance(a, dict) and start <= str(a.get("startTimeLocal") or "")[:10] <= end]


def fetch_day(api: Any, day: str, errors: list[str]) -> dict[str, Any]:
    return {
        "stats": call(errors, f"{day} stats", lambda: api.get_stats(day)),
        "sleep": call(errors, f"{day} sleep", lambda: api.get_sleep_data(day)),
        "hrv": call(errors, f"{day} hrv", lambda: api.get_hrv_data(day)),
        "training_readiness": call(errors, f"{day} readiness", lambda: api.get_training_readiness(day)),
        "max_metrics": call(errors, f"{day} max_metrics", lambda: api.get_max_metrics(day)),
    }


# ---------------------------------------------------------------- main

def main() -> None:
    key = load_key()
    email = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "")

    DATA.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {"version": 1, "days": {}, "activities": {}, "weights": []}
    if SUMMARY.exists():
        try:
            summary = decrypt(key, SUMMARY.read_bytes())
        except Exception:  # noqa: BLE001
            print("Existing summary could not be decrypted (key changed?). Starting a fresh history.")

    days_back = int(os.environ.get("JANOS_DAYS_BACK", "4"))
    backfill = int(os.environ.get("JANOS_BACKFILL_DAYS", "0") or 0)
    if not summary.get("days"):
        backfill = max(backfill, 60)
    span = max(days_back, backfill)

    home = Path(tempfile.mkdtemp())
    os.environ["HOME"] = str(home)
    token_dir = home / ".garminconnect"  # the library's default token folder
    api = login(email, password, home, key)
    save_tokens(api, key, token_dir, home)

    errors: list[str] = []
    today = dt.date.today()
    for i in range(span):
        day = (today - dt.timedelta(days=i)).isoformat()
        raw = fetch_day(api, day, errors)
        if all(v is None for v in raw.values()):
            continue  # nothing came back: keep whatever we already had for this day
        (RAW / f"{day}.enc").write_bytes(encrypt(key, raw))
        summary["days"][day] = summarize_day(day, raw)

    start = (today - dt.timedelta(days=span)).isoformat()
    activities = fetch_activities(api, start, today.isoformat(), errors)
    for a in activities:
        s = summarize_activity(a)
        if s["id"] is not None:
            summary["activities"][str(s["id"])] = s

    body = call(errors, "body composition", lambda: api.get_body_composition(start, today.isoformat()))
    known = {(w["t"], round(w["kg"], 2)) for w in summary.get("weights", [])}
    for w in summarize_weights(body):
        if (w["t"], round(w["kg"], 2)) not in known:
            summary.setdefault("weights", []).append(w)

    summary["generatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    summary["lastErrors"] = errors[-30:]
    SUMMARY.write_bytes(encrypt(key, summary))
    save_tokens(api, key, token_dir, home)
    print(f"Synced {span} days, {len(activities)} activities, {len(errors)} errors.")
    for e in errors[:20]:
        print("  ", e)


if __name__ == "__main__":
    main()
