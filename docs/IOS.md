# Shipping TIME SHATTER to the App Store

The iOS shell is a Capacitor wrapper around the same files the web serves.
**The game itself still has no build step** — no bundler, no transpiler, no
minifier. `tools/pack-native.mjs` only copies; the JavaScript inside the app
bundle is byte-identical to the JavaScript on the website.

---

## Why a wrapper and not a rewrite

WKWebView on modern iOS runs the same WebKit, the same JavaScriptCore with
JIT, and the same Metal-backed WebGL as Safari. **A wrapper is not faster
than the web build and nobody should claim otherwise.** What it buys is the
four things the web genuinely cannot give us:

| | Web | In the app |
|---|---|---|
| Haptics | `navigator.vibrate` — **not implemented by iOS Safari at all** | Core Haptics |
| Storage | localStorage, evictable under disk pressure | UserDefaults, durable |
| Offline | service worker cache, best effort | assets are in the bundle |
| Distribution | a URL | the App Store |

Performance work belongs in the game, not the shell — see the instanced shard
pools for the shape of it.

---

## One-time setup

```bash
npm install                 # Capacitor CLI + plugins (node_modules is gitignored)
npx cap add ios             # only if ios/ is missing; it is committed
```

Capacitor 8 uses Swift Package Manager, **not CocoaPods**, so there is no
`pod install` step and `npx cap add ios` works from any OS. Building and
signing still require macOS with Xcode 15+.

## Every build

```bash
npm run ios:sync            # pack native/www, then npx cap sync ios
npm run ios:open            # ...and open Xcode
```

In Xcode: select your team under **Signing & Capabilities**, pick a device,
Run. For TestFlight: **Product → Archive → Distribute App**.

---

## What is already configured

- **Portrait only**, iPhone and iPad. The game is portrait; rotating it is
  meaningless.
- **Status bar hidden**, `UIRequiresFullScreen`, no web-view scroll or
  rubber-band bounce — the three things that make a wrapper read as a web
  page rather than an app.
- **`arm64`** in `UIRequiredDeviceCapabilities`. The Capacitor template ships
  `armv7`, which is 32-bit and has not been supported since iOS 11.
- **App icon** at 1024×1024, **RGB with no alpha channel** — Apple rejects
  icons with alpha, and this is the single most common cause of a failed
  upload.
- **The service worker is not registered on native.** Every asset is already
  on the device, so a cache layer can only ever serve something stale after
  an update. `main.js` skips registration when `isNative()`.

---

## Before you can submit

| Item | Where | Notes |
|---|---|---|
| Apple Developer Program | developer.apple.com | $99/yr. **Nothing ships without it.** |
| Bundle ID | `capacitor.config.json` → `appId` | Currently `com.timeshatter.game`. **Permanent after first submission** — change it before you ship, not after. |
| App name | App Store Connect | Globally unique. Check availability before committing to it. |
| Age rating | App Store Connect | Expect **12+**. Answer the violence question "Infrequent/Mild Cartoon or Fantasy Violence" — there is no blood and enemies shatter into geometric shards. Do not overstate it or you land at 17+ for nothing. |
| App Privacy | App Store Connect | **"Data Not Collected"** everywhere. No analytics, no accounts, no network calls. Worth protecting. |
| Screenshots | App Store Connect | 6.7" (1290×2796) required. Capturable from the real game at that resolution. |

### The rejection risk worth naming

Guideline **4.2 Minimum Functionality** is what catches web wrappers. It
targets apps that are a browser pointed at a website. The defence is not an
argument, it is the build: the game runs entirely offline, has native
haptics, no browser chrome, no external links, and no way to tell from the
inside that it is a web view. Keep it that way — in particular **do not add
a link that opens the website**, which is the single clearest way to tell a
reviewer they are looking at a wrapper.

---

## Adding a native capability later

Game Center, IAP and the rest are Capacitor plugins or ~100 lines of Swift.
The pattern to follow is `src/native.js`: read `window.Capacitor.Plugins.X`
at runtime and fall back to a web equivalent or a no-op. **Never import from
`node_modules` in game code** — that is what would force a bundler and cost
us the buildless property.
