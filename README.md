# ROM

A social app: a shared **feed**, personal **workspaces** you can invite people into, **role-based access** (owner / editor / viewer), and a lightweight **app builder** inside each workspace. Built on **Firebase** (Auth + Firestore + Hosting) with a plain Vite single-page app — no framework.

The workspace/roles/invites/app-builder model mirrors the `quest-hq-command-center-rom` reference, reimplemented on Firestore.

## What it does

- **Auth** — email/password sign up & log in.
- **Feed** — every signed-in user sees and posts to one global feed.
- **Workspaces** — any user can create workspaces for their work.
- **Invites** — the owner/editors invite people by email; sharing the generated link lets that person join.
- **Roles** — **owner** (full control), **editor** (read + write), **viewer** (read only). Only the owner manages members and roles.
- **App builder** — inside a workspace, writers define mini "apps" (name + custom fields) and add records to them. Viewers can only look.

## Data model (Firestore)

```
users/{uid}                                  profile
posts/{postId}                               global feed
workspaces/{wsId}                            { name, ownerId }
workspaces/{wsId}/members/{uid}              { role: owner|editor|viewer }
workspaces/{wsId}/apps/{appId}               app definition (fields[])
workspaces/{wsId}/apps/{appId}/records/{id}  app data
invites/{inviteId}                           { workspaceId, email, role, status }
```

Access is enforced server-side by `firestore.rules`.

## Setup

Prerequisites: Node 18+, and the Firebase CLI (`npm i -g firebase-tools`) if you want to deploy.

1. **Install**
   ```bash
   npm install
   ```

2. **Firebase Console** (project `mysundayproject-50d65`)
   - **Authentication → Sign-in method →** enable **Email/Password**.
   - **Firestore Database →** create a database (production mode is fine; rules below lock it down).
   - **Project Settings → General → Your apps →** add/select a **Web app**, then copy the config values.

3. **Configure env**
   ```bash
   cp .env.example .env.local
   ```
   Paste your web config into `.env.local` (the `apiKey`, `appId`, `messagingSenderId`, etc.).
   > These are public browser identifiers — safe to expose. The **admin service-account key** in `C:\myweb\secrets` is *server-only* and is **not** used by this web app; keep it out of the repo (it's gitignored).

4. **Run**
   ```bash
   npm run dev
   ```
   Open http://127.0.0.1:5173.

5. **Deploy the security rules** (important — do this before real use)
   ```bash
   firebase deploy --only firestore:rules
   ```

6. **Deploy the site** (optional)
   ```bash
   npm run deploy
   ```

## Try it end-to-end

1. Sign up as User A → post to the feed.
2. Create a workspace → open it → **Apps** tab → build an app (e.g. "Contacts" with Name/Email fields) → add a record.
3. **Invites** tab → invite User B's email as *editor* → copy the link.
4. Open the link in another browser, sign up/log in as User B with that email → they join and can edit.
5. As the owner, change User B to *viewer* → they can now only view.

## Notes / next steps

- Invites are validated by email match in `firestore.rules`; there's no email *sending* yet — you share the link manually. Adding email delivery would be a Cloud Function.
- The app builder supports text / number / date / longtext fields. Extending it (select fields, editing records, etc.) is straightforward in `src/workspaces/data.js` + `workspaceView.js`.
