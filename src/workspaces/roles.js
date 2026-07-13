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
// The capabilities an owner can grant, grouped as View / Create / Manage.
// Enforcement is coarse in the embedded dashboard: `viewWorkspace` gates every
// "view" action, and any create/edit/interact action needs `post` or `editTiles`.
// `manage` (settings, members, invites, roles) is owner-only.
export const WS_PERMISSIONS = [
  { key: 'viewWorkspace', label: 'View feed, posts, apps, tiles & activity', group: 'view' },
  { key: 'post', label: 'Create posts, comments, apps & app items', group: 'create' },
  { key: 'editTiles', label: 'Create & edit dashboard tiles', group: 'create' },
  { key: 'interactTiles', label: 'Interact with tiles, calendar & checklists', group: 'create' },
];

const ALL_ON = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: true, post: true, deleteOwnPost: true, editTiles: true };
const VIEW_ONLY = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: false, post: false, deleteOwnPost: false, editTiles: false, manage: false };

// Preset roles → resolved permission sets. `manage` (settings/members) is owner-only.
// Owner = everything. Editor = view + create/edit/interact, no management.
// Viewer = view only.
export const ROLE_PRESETS = {
  owner: { ...ALL_ON, manage: true },
  editor: { ...ALL_ON, manage: false },
  viewer: { ...VIEW_ONLY },
};

// Resolve a member's effective permissions. Custom members carry their own `perms`
// (never granting `manage`, which stays owner-only).
export function resolvePerms(member, user) {
  if (user && isMaster(user)) return { ...ALL_ON, manage: true };
  if (!member) return { viewWorkspace: false, viewPosts: false, viewTiles: false, interactTiles: false, post: false, deleteOwnPost: false, editTiles: false, manage: false };
  if (member.role === 'custom' && member.perms) {
    return { ...ROLE_PRESETS.viewer, ...member.perms, manage: false };
  }
  return ROLE_PRESETS[member.role] || ROLE_PRESETS.viewer;
}

export const ASSIGNABLE_ROLES = ['owner', 'editor', 'viewer', 'custom'];
