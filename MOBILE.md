# ROMIO — Android app

ROMIO ships as a native Android app via **Capacitor**. The Android app runs the
exact same web build (`dist/`) inside a native shell — one codebase, no rewrite.

- App id: `com.romio.app`
- App name: `ROMIO`
- Native project: `android/` (committed)
- Web build served to the app: `dist/` (`webDir` in `capacitor.config.json`)

## Prerequisites (one-time)

1. **Android Studio** (https://developer.android.com/studio) — installs the JDK,
   Android SDK, and an emulator. That's all you need.
2. Node + this repo's deps already installed (`npm install`).

## Build & run

```bash
# builds the web app, copies it into the native project, and opens Android Studio
npm run android
```

Then in Android Studio:
- Let **Gradle sync** finish (first run downloads Gradle + SDK bits).
- Pick a device/emulator and press **Run** ▶ to launch, **or**
- **Build → Build Bundle(s)/APK(s) → Build APK(s)** for an installable `.apk`, or
  **Build → Generate Signed Bundle / APK** for a Play Store release (`.aab`).

### Update the app after changing web code

Any time you change the site, re-sync the native app:

```bash
npm run cap:sync   # rebuild web + copy into android/
```

(`npm run cap:open` just opens Android Studio without rebuilding.)

## App icon & splash (optional branding)

The project ships with Capacitor's default icons. To brand it:

```bash
npm i -D @capacitor/assets
# put a 1024x1024 icon at assets/icon.png (and optional splash.png), then:
npx @capacitor/assets generate --android
```

## Notes & caveats

- **Firebase config is bundled** (hardcoded fallback in `src/firebase.js`), so the
  app connects to the same `rom-database-0909` project with no extra setup. It
  needs **internet** (Firestore, fonts, icons, weather all load over the network;
  the INTERNET permission is included by default).
- **Email/password sign-in works** in the app's WebView.
- **Google/Facebook sign-in** uses a web popup that a plain WebView can't complete.
  For native social login, add `@capacitor-firebase/authentication` and configure
  the native Google/Facebook OAuth clients. Until then, use email/password on
  mobile (all other features work).
- The embedded **Workspace module** (iframe) is bundled locally and works in-app.
- iOS is also possible later: `npm i @capacitor/ios && npx cap add ios` (needs a
  Mac + Xcode).

## PWA (no build required)

The site is also an installable **PWA** (`public/manifest.webmanifest`): open
`romio-phi.vercel.app` in Chrome on Android → menu → **Add to Home screen**.
This is the quickest way to get an app-like icon without Android Studio.
