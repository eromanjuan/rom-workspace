import './styles.css';
import { configReady } from './firebase.js';
import { initTheme, applyThemeBundle, getThemeBundle } from './ui/theme.js';
import { watchAuth } from './auth/auth.js';
import { renderAuth } from './auth/authView.js';
import { renderVerify } from './auth/verifyView.js';
import { renderFeed } from './feed/feed.js';
import { renderProfile } from './profile/profileView.js';
import { renderUserProfile } from './profile/userProfile.js';
import { renderSearch } from './search/searchView.js';
import { renderMessages } from './messages/messagesView.js';
import { ensureDirectConversation } from './messages/messagesData.js';
import { renderSettings, openCreateWorkspaceModal } from './settings/settingsView.js';
import { renderFiles } from './files/filesView.js';
import { renderCalendar } from './tools/calendar.js';
import { renderChecklist } from './tools/checklist.js';
import { renderNotes } from './tools/notes.js';
import { getInvite, acceptInvite, getUserProfile, getMyRole, getWorkspace, setCurrentWorkspace, listMyWorkspaces, updateUserProfile } from './workspaces/data.js';
import { isMaster } from './workspaces/roles.js';
import { logOut } from './auth/auth.js';
import { openWorkspaceSettings } from './workspaces/workspaceSettings.js';
import { buildShell, renderPlaceholder } from './ui/shell.js';
import { mountNotifications } from './notifications/notificationsPanel.js';
import { el, clear, icon, toast } from './ui/dom.js';

initTheme();
const app = document.getElementById('app');

// Safety guard: if ROM is ever loaded inside an iframe of itself (same origin),
// don't render the shell — that would recurse infinitely. Show a link out instead.
if (window.top !== window.self) {
    app.innerHTML = '<div class="setup"><h1>ROMIO</h1><p>Open ROMIO in its own tab.</p><p><a href="/" target="_top">Go to ROMIO →</a></p></div>';
} else if (!configReady) {
    app.innerHTML = `
    <div class="setup">
      <h1>ROMIO</h1>
      <p>Almost there — ROMIO needs your Firebase web config before it can run.</p>
      <ol>
        <li>Copy <code>.env.example</code> to <code>.env.local</code>.</li>
        <li>Paste your web config from Firebase Console → Project Settings → Your apps.</li>
        <li>Enable <strong>Email/Password</strong> under Authentication, and create a <strong>Firestore</strong> database.</li>
        <li>Restart <code>npm run dev</code>.</li>
      </ol>
    </div>`;
} else {
    let viewUnsub = null;
    let notifCleanup = null;
    const VIEW_KEY = 'rom-view';
    const savedView = localStorage.getItem(VIEW_KEY);
    const validViews = ['feed', 'messages', 'profile', 'workspace', 'files', 'settings', 'calendar', 'checklist', 'notes'];
    const state = { view: validViews.includes(savedView) ? savedView : 'feed', wsId: null, pendingInvite: getInviteIdFromUrl() };

    // The embedded Workspace module can ask ROM to open a user's profile (e.g.
    // clicking an author name or @mention inside the iframe). Set by renderShell.
    let navigateToUser = null;
    window.addEventListener('message', (e) => {
        if (e.origin === location.origin && e.data && e.data.type === 'rom-open-user' && e.data.uid && navigateToUser) navigateToUser(e.data.uid);
    });

    // --- URL routing -------------------------------------------------------
    // Each view maps to a real path (/feed, /profile, /workspace/<name>, …) so
    // links are shareable and the browser back/forward buttons work. routeTo is
    // wired to go() by renderShell; one popstate listener replays history moves.
    const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    function viewToPath(view, arg) {
        switch (view) {
            case 'workspace': return arg ? `/workspace/${arg}` : '/workspace';
            case 'user': return arg ? `/user/${arg}` : '/user';
            case 'search': return arg ? `/search/${encodeURIComponent(arg)}` : '/search';
            case 'settings': return arg ? `/settings/${arg}` : '/settings';
            case 'messages': return arg ? `/messages/${arg}` : '/messages';
            case 'feed': case 'profile': case 'files': case 'calendar':
            case 'checklist': case 'notes': return `/${view}`;
            default: return '/feed';
        }
    }
    function parsePath() {
        const parts = location.pathname.split('/').filter(Boolean);
        const seg0 = parts[0] || 'feed';
        const arg = parts[1] ? decodeURIComponent(parts[1]) : null;
        if (!validViews.includes(seg0) && !['search', 'user'].includes(seg0)) return { view: 'feed', arg: null };
        return { view: seg0, arg };
    }
    let routeTo = null;
    window.addEventListener('popstate', () => { const r = parsePath(); if (routeTo) routeTo(r.view, r.arg, { fromPop: true }); });

    // Keep the shell avatars (topbar + sidebar) in sync with the saved photo.
    let setShellAvatar = null;
    window.addEventListener('rom-avatar-changed', (e) => { if (setShellAvatar) setShellAvatar(e.detail?.photoURL || ''); });

    // Persist theme changes (mode + palette + appearance) to the user's profile
    // so they follow them across devices. Debounced (sliders fire rapidly).
    let themeUser = null;
    let themeSaveTimer = null;
    window.addEventListener('rom-theme-changed', () => {
        if (!themeUser) return;
        clearTimeout(themeSaveTimer);
        themeSaveTimer = setTimeout(() => { updateUserProfile(themeUser.uid, { theme: getThemeBundle() }).catch(() => {}); }, 800);
    });

    watchAuth(async(user) => {
        if (viewUnsub) { viewUnsub();
            viewUnsub = null; }
        if (!user) {
            renderAuth(app);
            return;
        }
        // Require a verified email before entering the app (the master account is exempt).
        if (!user.emailVerified && !isMaster(user)) {
            renderVerify(app, user, () => proceed(user));
            return;
        }
        await proceed(user);
    });

    async function proceed(user) {
        // Handle a pending invite link now that we know who is logged in.
        if (state.pendingInvite) {
            await tryAcceptInvite(user, state.pendingInvite);
            state.pendingInvite = null;
            clearInviteFromUrl();
        }
        // Load the user's saved theme (persists across devices/logins). Applied
        // without emitting a change event so it isn't immediately re-saved. The
        // profile is fetched once here and reused by the shell (avatar).
        themeUser = user;
        let prof = null;
        try { prof = await getUserProfile(user.uid); if (prof?.theme) applyThemeBundle(prof.theme); } catch { /* ignore */ }
        // Dynamic master flag (promoted users) + suspend/ban enforcement.
        user.isMasterFlag = prof?.isMaster === true;
        if (!isMaster(user) && (prof?.deleted || prof?.suspended)) { renderBlocked(prof?.deleted ? 'deleted' : 'suspended'); return; }
        renderShell(user, prof);
    }

    // Shown to a suspended/removed account (a master can restore them).
    function renderBlocked(kind) {
        clear(app);
        const msg = kind === 'deleted'
            ? 'This account has been removed by an administrator.'
            : 'This account is suspended. Please contact an administrator.';
        app.append(el('div', { class: 'setup' }, [
            el('h1', {}, 'ROMIO'),
            el('p', {}, msg),
            el('button', { class: 'btn btn--primary', onclick: () => logOut() }, 'Log out'),
        ]));
    }

    function renderShell(user, profile) {
        clear(app);
        const shell = buildShell(user, { onNavigate: onNav, onSearch: (term) => go('search', term) });
        app.append(shell.root);
        const content = shell.content;
        const wsHost = shell.wsHost;
        let markViewNotifications = null; // set once the bell mounts
        let wsReadyHandler = null; // current iframe 'ready' listener (avoids leaks)
        // Open a user's profile — your own name goes to your editable profile,
        // anyone else's to their public profile view. (go is hoisted.)
        const openUserProfile = (uid) => { if (uid && uid === user.uid) go('profile'); else go('user', uid); };
        // Start (or open) a direct chat with someone, then jump to Messages.
        const openDirectMessage = async (targetUid, targetName) => {
            if (!targetUid || targetUid === user.uid) return;
            try {
                const cid = await ensureDirectConversation(
                    { uid: user.uid, name: user.displayName || user.email },
                    { uid: targetUid, name: targetName || '' },
                );
                go('messages', cid);
            } catch (err) { toast(err.message || 'Could not open chat.', 'error'); }
        };
        // Let the embedded module navigate ROM to a user profile.
        navigateToUser = openUserProfile;
        // Notification bell: live badge + panel; navigates to where each was fired.
        // Also drives per-view sidebar activity badges (messages/feed/workspace).
        if (notifCleanup) notifCleanup();
        const navNotif = mountNotifications(shell.bell, user, {
            onNavigate: (view, arg) => go(view, arg),
            onCounts: (byView) => {
                shell.setNavBadge('messages', byView.messages || 0);
                shell.setNavBadge('feed', byView.feed || 0);
                shell.setNavBadge('workspace', byView.workspace || 0);
            },
        });
        notifCleanup = navNotif.cleanup;
        markViewNotifications = navNotif.markViewRead;
        // Apply the saved profile photo to the shell avatars + keep them live.
        setShellAvatar = shell.setAvatar;
        if (profile?.photoURL) shell.setAvatar(profile.photoURL);

        function onNav(view, item) {
            if (item?.soon) { toast(`${item.label} is coming soon.`, 'info'); return; }
            go(view);
        }

        // The embedded (quest-hq) Workspace module in a persistent iframe — gated on
        // membership of the user's default workspace. Removed members are blocked.
        async function mountWorkspace(slug) {
            const master = isMaster(user);
            let wsId = null; let role = null; let wsExists = false; let wsDoc = null;
            try {
                const p = await getUserProfile(user.uid);
                wsId = p?.currentWorkspaceId || null;
                // Deep link /workspace/<slug>: switch to that workspace if it's mine.
                if (slug) {
                    try {
                        const mine = await listMyWorkspaces(user.uid);
                        const match = mine.find((w) => w.id === slug || slugify(w.name) === slug);
                        if (match && match.id !== wsId) { await setCurrentWorkspace(user.uid, match.id); wsId = match.id; }
                    } catch { /* ignore */ }
                }
                if (wsId) {
                    // The selected workspace may have been deleted — verify it still exists.
                    wsDoc = await getWorkspace(wsId);
                    wsExists = !!wsDoc;
                    if (wsExists) role = await getMyRole(wsId, user.uid);
                }
            } catch { /* ignore */ }

            // Canonicalize the URL to the workspace name (e.g. /workspace/dev-nerds).
            if (wsDoc) {
                const canonical = `/workspace/${slugify(wsDoc.name) || wsId}`;
                if (location.pathname !== canonical) history.replaceState({}, '', canonical);
            }

            // No usable workspace: none selected, or the selected one was deleted.
            // Show a blank state with a Create Workspace button (for everyone).
            if (!wsId || !wsExists) {
                wsHost.dataset.mountedWs = '';
                clear(wsHost);
                const createBtn = el('button', { class: 'btn btn--primary' }, [icon('plus'), ' Create workspace']);
                createBtn.onclick = () => openCreateWorkspaceModal(user, async (newId) => {
                    try { if (newId) await setCurrentWorkspace(user.uid, newId); } catch { /* ignore */ }
                    mountWorkspace();
                });
                wsHost.append(el('div', { class: 'placeholder' }, [
                    el('div', { class: 'placeholder-icon' }, icon('layout-dashboard')),
                    el('h2', {}, 'No workspace yet'),
                    el('p', { class: 'muted' }, 'Create a workspace to start building apps, tiles and posts.'),
                    createBtn,
                ]));
                return;
            }

            // A workspace is selected and exists, but this (non-master) user isn't a member.
            if (!master && !role) {
                wsHost.dataset.mountedWs = '';
                clear(wsHost);
                wsHost.append(el('div', { class: 'placeholder' }, [
                    el('div', { class: 'placeholder-icon' }, icon('lock')),
                    el('h2', {}, 'No access to this workspace'),
                    el('p', { class: 'muted' }, 'You are not a member of this workspace. Ask the owner to invite you, or pick another in Settings.'),
                    el('button', { class: 'btn btn--primary', onclick: () => go('settings') }, 'Go to Settings'),
                ]));
                return;
            }

            // Remount a fresh iframe only when the active workspace actually changes,
            // so switching workspaces reloads the module with the new workspace's data
            // (the bridge scopes everything to the current workspace).
            const key = wsId || (master ? 'master' : '');
            if (wsHost.dataset.mountedWs === key) return;
            wsHost.dataset.mountedWs = key;
            clear(wsHost);
            const loading = el('div', { class: 'ws-loading' }, [
                el('div', { class: 'ws-spinner' }),
                el('div', { class: 'muted' }, 'Loading workspace…'),
            ]);
            const frame = el('iframe', { class: 'ws-module-frame', src: '/workspace-module/index.html?v=20', title: 'Workspace' });
            const gear = el('button', { class: 'ws-gear', title: 'Workspace settings', style: 'display:none' }, icon('settings'));
            wsHost.append(frame, gear, loading);

            // Hide the spinner when the module signals ready. Self-removing +
            // clears any previous handler so switching workspaces doesn't leak
            // a growing pile of 'message' listeners.
            if (wsReadyHandler) window.removeEventListener('message', wsReadyHandler);
            const clearReady = () => { if (wsReadyHandler) { window.removeEventListener('message', wsReadyHandler); wsReadyHandler = null; } };
            wsReadyHandler = (e) => {
                if (e.origin === location.origin && e.data && e.data.type === 'rom-ws-ready') { loading.remove(); clearReady(); }
            };
            window.addEventListener('message', wsReadyHandler);
            setTimeout(() => { loading.remove(); clearReady(); }, 12000);

            if (wsId && (role === 'owner' || master)) {
                gear.style.display = '';
                gear.onclick = () => openWorkspaceSettings(wsId, user, () => {
                    try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; }
                });
            }
        }

        function go(view, arg = null, opts = {}) {
            if (viewUnsub) { viewUnsub(); viewUnsub = null; }
            state.view = view;
            state.wsId = view === 'workspace' ? arg : null;
            // search + user profile don't highlight a sidebar item.
            const navView = (view === 'search' || view === 'user') ? 'feed' : view;
            shell.setActive(navView);
            // Visiting a view clears its activity badge.
            if (markViewNotifications && ['feed', 'messages', 'workspace'].includes(navView)) markViewNotifications(navView);

            // Reflect the view in the URL (skip when replaying back/forward).
            if (!opts.fromPop) {
                const path = viewToPath(view, arg);
                if (opts.replace || location.pathname === path) history.replaceState({}, '', path);
                else history.pushState({}, '', path);
            }

            const isWorkspace = view === 'workspace';
            content.style.display = isWorkspace ? 'none' : '';
            wsHost.style.display = isWorkspace ? 'block' : 'none';
            if (isWorkspace) { mountWorkspace(arg); return; }

            clear(content);
            content.style.padding = '';
            if (view === 'feed') {
                viewUnsub = renderFeed(content, user, { onOpenUser: openUserProfile });
            } else if (view === 'messages') {
                viewUnsub = renderMessages(content, user, { initialConvId: arg, onOpenUser: openUserProfile });
            } else if (view === 'profile') {
                viewUnsub = renderProfile(content, user, { onOpenWorkspace: () => go('workspace') });
            } else if (view === 'search') {
                viewUnsub = renderSearch(content, user, arg || '', { onOpenUser: openUserProfile, onOpenWorkspace: () => go('workspace'), onMessage: openDirectMessage });
            } else if (view === 'user') {
                viewUnsub = renderUserProfile(content, arg, user, { onBack: () => go('feed'), onOpenUser: openUserProfile, onMessage: openDirectMessage, onOpenWorkspace: () => go('workspace') });
            } else if (view === 'settings') {
                viewUnsub = renderSettings(content, user, { onOpenWorkspace: () => go('workspace'), section: arg });
            } else if (view === 'files') {
                renderFiles(content, user);
            } else if (view === 'calendar') {
                viewUnsub = renderCalendar(content, user);
            } else if (view === 'checklist') {
                viewUnsub = renderChecklist(content, user);
            } else if (view === 'notes') {
                viewUnsub = renderNotes(content, user);
            } else {
                renderPlaceholder(content, 'Coming soon', 'This module is part of a later phase.');
            }
        }

        // Navigate to whatever the current URL points at (deep links + refresh).
        routeTo = go;
        const initial = parsePath();
        go(initial.view, initial.arg, { replace: true });
    }

    async function tryAcceptInvite(user, inviteId) {
        try {
            const invite = await getInvite(inviteId);
            if (!invite || invite.status !== 'pending') {
                toast('That invite is no longer valid.', 'error');
                return;
            }
            if (invite.email !== (user.email || '').toLowerCase()) {
                toast(`This invite is for ${invite.email}. Log in with that email to accept.`, 'error');
                return;
            }
            await acceptInvite(user, invite);
            toast('You joined the workspace!', 'success');
            state.view = 'workspace';
            state.wsId = invite.workspaceId;
        } catch (err) {
            toast(err.message || 'Could not accept invite.', 'error');
        }
    }
}

function getInviteIdFromUrl() {
    return new URLSearchParams(location.search).get('invite');
}

function clearInviteFromUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('invite');
    history.replaceState({}, '', url);
}