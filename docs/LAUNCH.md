# Launch runbook — domain, web, App Store

Everything only you can do, in the order it has to happen. Steps marked
**[me]** are mine once you've done the one before.

---

## Part 1 — The domain decision

### Use `timeshatter.app`. Don't use the hyphen.

`time-shatter.com` at a penny saves **~$5/year** after the first. What it
costs:

- **You will say it out loud.** "time dash shatter dot com" is the sentence
  you're signing up for, in every conversation about this game, forever.
- **Typo traffic goes to someone else.** People type `timeshatter.com` from
  memory. The fact that the hyphenated version is being pushed at you for a
  penny is a strong signal the clean one is already owned — so that traffic
  lands on a stranger's parking page. Check `timeshatter.com` before you
  decide; if it's free, buy it too and redirect. If it's not, that's an
  argument *against* the hyphen, not for it.
- **It reads cheap on your App Store page**, where the support URL is
  visible to every prospective player.

$5/year is not the axis to optimise. Which brings us to the axis that is:

### Buy it at Cloudflare Registrar, not wherever quoted you $28

Cloudflare Registrar sells domains **at wholesale with no markup and no
renewal jump** — the price you pay in year one is the price in year five.
For `.app` that's typically **around $14/year** against the **$28** you were
quoted. Verify at checkout, but over five years that's roughly **$70 saved**,
which is an order of magnitude more than the penny-domain gimmick and comes
with none of the downsides.

You're already on Cloudflare, so this is also one less account.

**Gotchas on penny domains generally**, if you go that way anyway: they
often bundle paid add-ons at checkout that you have to actively uncheck, and
ICANN locks a new registration against transfer for **60 days** — so if you
dislike the registrar, you're stuck with them for two months.

### What to do with the domains you already have

| Domain | Verdict |
|---|---|
| `stack-it.app` | Different product. Leave it. |
| `swarm-game.onlinestuff4me.workers.dev` | A `workers.dev` subdomain, not a domain you own. Fine for testing, never for shipping. |
| `mischastephens.com` | Your name. Wrong for a game. |
| **`littlebearlabs.com`** | **Use this — as the studio, not the game.** |

That last one is the useful idea here. `littlebearlabs.com` already reads
like a games studio, and Apple asks for a **seller name** and a **marketing
URL** that are meant to be the publisher, not the title. So:

- **`littlebearlabs.com`** — studio site, lists the games, holds the support
  and privacy pages Apple requires.
- **`timeshatter.app`** — the game itself, which is what the PWA runs on and
  what you put on a poster.

Doing it this way means game #2 costs you one more domain, not a rebrand.
It also means the privacy policy and support URLs Apple requires live
somewhere permanent instead of on a page you'd have to move later.

---

## Part 2 — Wiring the domain to the live game

Do these in order. The whole thing takes about 20 minutes plus DNS
propagation.

### 2.1 Buy it

Cloudflare Dashboard → **Domain Registration** → **Register Domain** →
`timeshatter.app`. It lands in your account with DNS already delegated, so
there is no nameserver step.

### 2.2 Add the DNS records

Cloudflare → `timeshatter.app` → **DNS** → **Records**. Add five:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | `185.199.108.153` | **DNS only** |
| A | `@` | `185.199.109.153` | **DNS only** |
| A | `@` | `185.199.110.153` | **DNS only** |
| A | `@` | `185.199.111.153` | **DNS only** |
| CNAME | `www` | `onlinestuff4me-sketch.github.io` | **DNS only** |

> **The one that breaks everything:** the proxy toggle must be **grey cloud
> (DNS only)**, not orange. With the proxy on, GitHub cannot complete the
> ACME challenge that issues your certificate, and you get a site that
> either won't load or throws certificate warnings with no obvious cause.
> You can turn the proxy on *later*, after the certificate exists — but
> there is no reason to, and if you do you must also set SSL/TLS mode to
> **Full (strict)**. **Flexible** causes an infinite redirect loop with
> GitHub Pages. This is the single most common way this setup fails.

### 2.3 Point GitHub at it

Repo → **Settings** → **Pages** → **Custom domain** → `timeshatter.app` →
Save. GitHub runs a DNS check, then issues a certificate. Wait for the
check to go green — usually minutes, occasionally an hour.

Then tick **Enforce HTTPS**. It stays greyed out until the certificate is
issued, which is your signal that 2.2 worked.

### 2.4 **[me]** The repo side

Tell me the domain is live and I'll:

- add the `CNAME` file (GitHub adds one automatically, but committing it
  stops a later push from wiping it — a genuinely common way to lose a
  custom domain without noticing)
- update `manifest.json` `start_url` and `scope`
- update the service worker's cache key so existing players get the new
  origin instead of a stale cache
- add the `apple-mobile-web-app` meta tags so an iPhone home-screen install
  looks right before the native app ships

### 2.5 The redirect, if you bought a second domain

Cloudflare → **Rules** → **Redirect Rules** → single redirect,
`time-shatter.com/*` → `https://timeshatter.app/$1`, **301 permanent**.
Do not serve the game from two origins — it splits your PWA installs and
your localStorage, so a player's scores would depend on which URL they
happened to use.

---

## Part 3 — App Store setup

You have the developer account, so this is all App Store Connect plus one
decision in the repo.

### 3.1 **Decide the bundle ID first — it is permanent**

Convention for a `.app` domain is reverse-DNS of the domain:

```
app.timeshatter.game
```

It is currently the placeholder `com.timeshatter.game`. **Tell me which you
want and I'll change it** — after your first submission it cannot be changed
without shipping a different app and losing your reviews and rankings.

If you go the studio route, `com.littlebearlabs.timeshatter` is equally
correct and groups future games under one identifier. I'd pick that one.

### 3.2 Register the App ID

developer.apple.com → **Certificates, IDs & Profiles** → **Identifiers** →
**+** → App IDs → App → paste the bundle ID.

Enable **Game Center** here. You said yes to it, and it has to be on the App
ID before the entitlement will work.

### 3.3 Create the app record

appstoreconnect.apple.com → **My Apps** → **+** → **New App**:

- **Platform** iOS · **Name** TIME SHATTER · **Language** English (U.S.)
- **Bundle ID** the one from 3.2 · **SKU** anything, e.g. `timeshatter-001`

If the name is taken, App Store Connect tells you here and you pick another.
This is the only place that answer exists.

### 3.4 Fill the listing

| Field | What to put |
|---|---|
| **Subtitle** (30 chars) | This does the work you wanted the name to do. `Stop time. Shoot. Shatter.` (26) or `Freeze time, clear the floor` (28). It appears under the name in search results and is the main thing that tells a browser what the game is. |
| **Promotional text** (170) | Editable without a new build — use it for what's new. |
| **Description** | Lead with the mechanic in the first two lines; that's all that shows before "more". |
| **Keywords** (100, comma-separated, no spaces) | `slowmo,bullet time,fps,shooter,arcade,time,reflex,one hit,roguelike,portrait` — don't repeat words from the name or subtitle, they're already indexed. |
| **Support URL** | Required. `littlebearlabs.com/support` |
| **Marketing URL** | `timeshatter.app` |
| **Privacy Policy URL** | Required even though we collect nothing. `littlebearlabs.com/privacy` |
| **Category** | Games → Action (secondary: Arcade) |

### 3.5 Age rating

Expect **12+**. On the violence question answer **"Infrequent/Mild Cartoon
or Fantasy Violence"** — there is no blood, no gore, and enemies break into
geometric shards. Don't overstate it; overstating lands you at 17+ and costs
you reach for nothing.

### 3.6 App Privacy

**"Data Not Collected"** for every category. No analytics, no accounts, no
network calls, scores are local. This is the easiest privacy review you will
ever file and it is worth protecting — think hard before adding anything
that changes this answer.

### 3.7 Screenshots

**Attached to this message, already at 1290×2796** (6.7", the only required
size). Four of them: menu, corridor, bullet time, mid-shatter. Drag them in.

Apple accepts 3–10. If you want different moments, tell me which and I'll
render them — the capture runs against the real game at the exact size, so
there's no scaling or mockup involved.

### 3.8 Game Center

App Store Connect → your app → **Features** → **Game Center**. Turn it on
and create the leaderboards before the first build, because retrofitting
means your early players have no history on the new board.

My recommendation for what to create:

| Leaderboard | ID | Why |
|---|---|---|
| Deepest door | `deepest_door` | The obvious one. Endurance. |
| Longest run | `longest_time` | Already tracked. |
| Doors on one bank | `doors_one_bank` | **The challengeable one** — a skill expression rather than a time investment, which is what makes a Challenge worth accepting. |

**[me]** once these exist: wire submission through `src/native.js` the same
way haptics went in, so the web build is unaffected.

### 3.9 Build and upload

On your Mac, in the repo:

```bash
npm install
npm run ios:open
```

In Xcode: **Signing & Capabilities** → select your team → add the **Game
Center** capability. Then **Product → Archive → Distribute App → TestFlight
& App Store**.

First upload usually gets an automated email about missing icon sizes or an
`ITMS` warning. Send me the text and I'll fix it — those are almost always
asset metadata, not code.

---

## The order that matters

1. Buy the domain **(you)** → 2. DNS **(you)** → 3. GitHub Pages
**(you)** → 4. repo wiring **[me]** → 5. bundle ID decision **(you)** →
6. App ID + app record **(you)** → 7. Game Center boards **(you)** →
8. Game Center wiring **[me]** → 9. Archive and upload **(you)**.

Steps 1–3 have DNS propagation in them, so start them first; 5 is the one
that is irreversible, so don't rush it.
