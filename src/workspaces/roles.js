// The master / super-admin account: full access to every workspace and role,
// regardless of membership. Enforced in the client AND in firestore.rules.
export const MASTER_EMAIL = 'eugenioiromanjuan@gmail.com';

// Master = the original hardcoded account OR anyone promoted (isMasterFlag is set
// on the auth-user object from their profile's isMaster field after login).
export function isMaster(user) {
  if (!user) return false;
  if ((user.email || '').toLowerCase() === MASTER_EMAIL) return true;
  return user.isMasterFlag === true;
}

// Role model shared across the app. Mirrors quest-hq: owner has full access,
// editor can read + write, viewer is read-only.
export const ROLES = {
  owner: { label: 'Owner', canWrite: true, canManage: true, rank: 3 },
  editor: { label: 'Editor', canWrite: true, canManage: false, rank: 2 },
  viewer: { label: 'Viewer', canWrite: false, canManage: false, rank: 1 },
};

export const INVITABLE_ROLES = ['editor', 'viewer'];

export function canWrite(role) {
  return Boolean(ROLES[role]?.canWrite);
}

export function canManage(role) {
  return Boolean(ROLES[role]?.canManage);
}

export function roleLabel(role) {
  return ROLES[role]?.label || role;
}

// --- fine-grained workspace permissions ---
// Each capability is its own toggle (for Custom roles). They fall into View and
// Create groups; management (settings/members/invites/roles) stays owner-only and
// is NOT a per-member toggle.
export const WS_PERMISSIONS = [
  { key: 'viewFeed', label: 'View workspace feed', group: 'view' },
  { key: 'viewPosts', label: 'View workspace posts', group: 'view' },
  { key: 'viewApps', label: 'View apps in workspace', group: 'view' },
  { key: 'viewTiles', label: 'View tiles', group: 'view' },
  { key: 'viewActivity', label: 'View recent activity', group: 'view' },
  { key: 'createPost', label: 'Create posts', group: 'create' },
  { key: 'createComment', label: 'Comment on workspace posts', group: 'create' },
  { key: 'createApps', label: 'Create apps', group: 'create' },
  { key: 'createItems', label: 'Create items on apps', group: 'create' },
  { key: 'createTiles', label: 'Create tiles', group: 'create' },
  { key: 'editTiles', label: 'Edit tiles', group: 'create' },
  { key: 'interactTiles', label: 'Interact with tiles', group: 'create' },
  { key: 'addEvent', label: 'Add calendar events', group: 'create' },
  { key: 'addChecklist', label: 'Add checklists', group: 'create' },
];

export const WS_VIEW_KEYS = ['viewFeed', 'viewPosts', 'viewApps', 'viewTiles', 'viewActivity'];
export const WS_CREATE_KEYS = ['createPost', 'createComment', 'createApps', 'createItems', 'createTiles', 'editTiles', 'interactTiles', 'addEvent', 'addChecklist'];

const VIEW_ALL = Object.fromEntries(WS_VIEW_KEYS.map((k) => [k, true]));
const CREATE_ALL = Object.fromEntries(WS_CREATE_KEYS.map((k) => [k, true]));

// Preset roles → resolved permission sets. Owner = everything. Editor = view +
// all create (no management). Viewer = view only. `manage` is owner-only.
export const ROLE_PRESETS = {
  owner: { ...VIEW_ALL, ...CREATE_ALL, manage: true },
  editor: { ...VIEW_ALL, ...CREATE_ALL, manage: false },
  viewer: { ...VIEW_ALL, manage: false },
};

// True if a permission set grants any create/edit/interact capability.
export function hasWritePerm(perms) {
  return WS_CREATE_KEYS.some((k) => perms && perms[k]);
}

// Resolve a member's effective permissions. Custom members carry their own `perms`
// (never granting `manage`, which stays owner-only).
export function resolvePerms(member, user) {
  if (user && isMaster(user)) return { ...ROLE_PRESETS.owner };
  if (!member) return {};
  if (member.role === 'custom' && member.perms) {
    return { ...member.perms, manage: false };
  }
  return ROLE_PRESETS[member.role] || ROLE_PRESETS.viewer;
}

export const ASSIGNABLE_ROLES = ['owner', 'editor', 'viewer', 'custom'];
