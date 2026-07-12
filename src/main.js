import './styles.css';
import { configReady } from './firebase.js';
import { initTheme } from './ui/theme.js';
import { watchAuth } from './auth/auth.js';
import { renderAuth } from './auth/authView.js';
import { renderVerify } from './auth/verifyView.js';
import { renderFeed } from './feed/feed.js';
import { renderProfile } from './profile/profileView.js';
import { renderUserProfile } from './profile/userProfile.js';
import { renderSearch } from './search/searchView.js';
import { renderSettings } from './settings/settingsView.js';
import { renderFiles } from './files/filesView.js';
import { renderCalendar } from './tools/calendar.js';
import { renderChecklist } from './tools/checklist.js';
import { renderNotes } from './tools/notes.js';
import { getInvite, acceptInvite, getUserProfile, getMyRole } from './workspaces/data.js';
import { isMaster } from './workspaces/roles.js';
import { openWorkspaceSettings } from './workspaces/workspaceSettings.js';
import { buildShell, renderPlaceholder } from './ui/shell.js';
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
    const VIEW_KEY = 'rom-view';
    const savedView = localStorage.getItem(VIEW_KEY);
    const validViews = ['feed', 'profile', 'workspace', 'files', 'settings', 'calendar', 'checklist', 'notes'];
    const state = { view: validViews.includes(savedView) ? savedView : 'feed', wsId: null, pendingInvite: getInviteIdFromUrl() };

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
        renderShell(user);
    }

    function renderShell(user) {
        clear(app);
        const shell = buildShell(user, { onNavigate: onNav, onSearch: (term) => go('search', term) });
        app.append(shell.root);
        const content = shell.content;
        const wsHost = shell.wsHost;

        function onNav(view, item) {
            if (item?.soon) { toast(`${item.label} is coming soon.`, 'info'); return; }
            go(view);
        }

        // The embedded (quest-hq) Workspace module in a persistent iframe — gated on
        // membership of the user's default workspace. Removed members are blocked.
        async function mountWorkspace() {
            if (wsHost.dataset.mounted) return; // already mounted with access
            const master = isMaster(user);
            let wsId = null; let role = null;
            try {
                const p = await getUserProfile(user.uid);
                wsId = p?.currentWorkspaceId || null;
                if (wsId) role = await getMyRole(wsId, user.uid);
            } catch { /* ignore */ }

            if (!master && (!wsId || !role)) {
                clear(wsHost);
                wsHost.append(el('div', { class: 'placeholder' }, [
                    el('div', { class: 'placeholder-icon' }, icon(wsId ? 'lock' : 'layout-dashboard')),
                    el('h2', {}, wsId ? 'No access to this workspace' : 'No workspace selected'),
                    el('p', { class: 'muted' }, wsId
                        ? 'You are not a member of this workspace. Ask the owner to invite you, or pick another in Settings.'
                        : 'Choose or create your default workspace in Settings.'),
                    el('button', { class: 'btn btn--primary', onclick: () => go('settings') }, 'Go to Settings'),
                ]));
                return;
            }

            wsHost.dataset.mounted = '1';
            clear(wsHost);
            const loading = el('div', { class: 'ws-loading' }, [
                el('div', { class: 'ws-spinner' }),
                el('div', { class: 'muted' }, 'Loading workspace…'),
            ]);
            const frame = el('iframe', { class: 'ws-module-frame', src: '/workspace-module/index.html?v=10', title: 'Workspace' });
            const gear = el('button', { class: 'ws-gear', title: 'Workspace settings', style: 'display:none' }, icon('settings'));
            wsHost.append(frame, gear, loading);

            window.addEventListener('message', (e) => {
                if (e.origin === location.origin && e.data && e.data.type === 'rom-ws-ready') loading.remove();
            });
            setTimeout(() => loading.remove(), 12000);

            if (wsId && (role === 'owner' || master)) {
                gear.style.display = '';
                gear.onclick = () => openWorkspaceSettings(wsId, user, () => {
                    try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; }
                });
            }
        }

        function go(view, arg = null) {
            if (viewUnsub) { viewUnsub(); viewUnsub = null; }
            state.view = view;
            state.wsId = view === 'workspace' ? arg : null;
            // search + user profile are transient — don't persist/restore them.
            const navView = (view === 'search' || view === 'user') ? 'feed' : view;
            localStorage.setItem(VIEW_KEY, navView); // remember across refreshes
            shell.setActive(navView);

            const isWorkspace = view === 'workspace';
            content.style.display = isWorkspace ? 'none' : '';
            wsHost.style.display = isWorkspace ? 'block' : 'none';
            if (isWorkspace) { mountWorkspace(); return; }

            clear(content);
            content.style.padding = '';
            if (view === 'feed') {
                viewUnsub = renderFeed(content, user);
            } else if (view === 'profile') {
                viewUnsub = renderProfile(content, user);
            } else if (view === 'search') {
                viewUnsub = renderSearch(content, user, arg || '', { onOpenUser: (uid) => go('user', uid), onOpenWorkspace: () => go('workspace') });
            } else if (view === 'user') {
                viewUnsub = renderUserProfile(content, arg, user, { onBack: () => go('feed') });
            } else if (view === 'settings') {
                renderSettings(content, user, { onOpenWorkspace: () => go('workspace') });
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

        go(state.view, state.wsId);
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