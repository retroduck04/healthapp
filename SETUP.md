# Janos Health: one-time setup (about 15 minutes)

Everything here is free. You do it once. After that, Garmin data arrives automatically every 3 hours.

## 1. Put the code on GitHub (Windows laptop)

1. Install **GitHub Desktop** (desktop.github.com). Sign in, or create a free GitHub account.
2. In this `janos` folder, create a folder named `.github`. Inside it, create a folder named `workflows`. Move `setup\garmin-sync.yml` into it, so the file ends up at `janos\.github\workflows\garmin-sync.yml`.
   If Windows won't accept the name `.github`, type `.github.` (with a dot at the end). Windows removes the extra dot.
3. In GitHub Desktop, choose **File → Add local repository** and pick this `janos` folder. When it says the folder isn't a repository, click **create a repository**, then **Create repository**.
4. Click **Publish repository** and **untick "Keep this code private"**. Free hosting needs a public repo. Your health data is encrypted before it's stored, so it stays private.

## 2. Turn on the website

1. On github.com, open your `janos` repository and go to **Settings → Pages**.
2. Under Source, pick **Deploy from a branch**. Set the branch to **main** and the folder to **/docs**, then click **Save**.
3. After a minute or two the page shows your address, something like `https://yourname.github.io/janos/`.

## 3. Install it on the iPhone

1. Open that address in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. From now on, always open Janos Health from the **home screen icon**, not from a Safari tab. The home screen app keeps its own storage.

## 4. Connect Garmin (on the iPhone)

1. In the Janos app, tap the gear icon (**Settings**), then **Create sync key and copy it**.
2. In Safari, go to github.com → your `janos` repo → **Settings → Secrets and variables → Actions**. Add these three secrets with **New repository secret**:

   | Name | Value |
   |---|---|
   | `JANOS_DATA_KEY` | paste the key you just copied |
   | `GARMIN_EMAIL` | your Garmin Connect email |
   | `GARMIN_PASSWORD` | your Garmin Connect password |

3. Go to the repo's **Actions** tab. If GitHub asks, click **I understand, enable workflows**. Then open **Garmin sync → Run workflow → Run workflow**.
4. The first run downloads 60 days of history and takes about 5–10 minutes. After that, open the app: sleep, HRV, resting heart rate, steps and workouts appear by themselves.

If the run fails at login, check two things:

- The Garmin email and password secrets are correct.
- Two-step verification is **off** in your Garmin account. The automatic login can't answer a code.

## Good to know

- **Backups.** Your food, weights and lifts live only on the phone. When the app reminds you (weekly), tap it and save the backup to Files or iCloud Drive.
- **Updates.** When Claude changes the app, it writes the new files into this folder. You open GitHub Desktop, click **Commit to main**, then **Push origin**. The app shows "A new version is ready"; tap **Update**.
- **Garmin's terms.** This sync uses an unofficial login, which is against Garmin's terms. The worst realistic outcome is that Garmin blocks the login or asks you to reset your password. If that happens, disable the workflow in the Actions tab and everything else keeps working.
