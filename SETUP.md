# Janos Health: setup

- Your app: **https://retroduck04.github.io/healthapp/**
- Repo: **github.com/retroduck04/healthapp**. On the laptop it lives in `Downloads\Jhealth\healthapp`.

## Garmin sync

Garmin blocks password logins that come from GitHub's servers. So you log in once from your laptop, and GitHub reuses (and keeps refreshing) that login.

1. **Update the workflow file:** drag `setup\garmin-sync.yml` into `.github\workflows` and choose **Replace**.
2. **Log in once:** double-click `tools\Connect Garmin.bat`.
   - If it installs Python, close the window and double-click it again.
   - Type your Garmin email and password. If Garmin sends a code, type that too.
   - It ends with "COPIED to your clipboard".
3. **Save the tokens on GitHub:** open github.com/retroduck04/healthapp/settings/secrets/actions/new.
   - Name: `GARMIN_TOKENS`
   - Secret: Ctrl+V
   - Click **Add secret**.
4. **Upload the changes:** in GitHub Desktop, click **Commit to main**, then **Push origin**.
5. **Run it:** go to github.com/retroduck04/healthapp/actions, click **Garmin sync**, then **Run workflow → Run workflow**.

After that it runs by itself every 3 hours. Two-step verification on your Garmin account can stay on.

If the sync ever says the tokens stopped working (for example after you change your Garmin password), repeat steps 2–3. When you replace the secret, use **Update secret** on GARMIN_TOKENS.

## Secrets used (Settings → Secrets and variables → Actions)

| Name | What |
|---|---|
| `JANOS_DATA_KEY` | the key from the app (Settings → Garmin sync). Only your phone can read your data with it. |
| `GARMIN_TOKENS` | copied by `tools\Connect Garmin.bat` |
| `GARMIN_EMAIL`, `GARMIN_PASSWORD` | backup only. Garmin usually blocks these from GitHub. |

## Good to know

- **Backups.** Your food, weights and lifts live only on the phone. When the app reminds you (weekly), tap it and save the backup to Files or iCloud Drive.
- **Updates.** When Claude changes the app, it writes the files into `Jhealth\healthapp`. Then you click **Commit to main** and **Push origin** in GitHub Desktop. The app shows "A new version is ready"; tap **Update**.
- **Garmin's terms.** This sync uses an unofficial login, which is against Garmin's terms. The worst realistic outcome is that Garmin blocks it or asks you to reset your password. If that happens, disable the workflow in the Actions tab; the rest of the app keeps working.
