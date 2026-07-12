// The master / super-admin account: full access to every workspace and role,
// regardless of membership. Enforced in the client AND in firestore.rules.
export const MASTER_EMAIL = 'eugenioiromanjuan@gmail.com';

export function isMaster(user) {
  return !!user && (user.email || '').toLowerCase() === MASTER_EMAIL;
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
// The capabilities an owner can grant. Grouped so the UI reads as read / interact / write.
export const WS_PERMISSIONS = [
  { key: 'viewWorkspace', label: 'View workspace', group: 'read' },
  { key: 'viewPosts', label: 'View posts', group: 'read' },
  { key: 'viewTiles', label: 'View tiles', group: 'read' },
  { key: 'interactTiles', label: 'Interact with tiles', group: 'interact' },
  { key: 'post', label: 'Post to workspace', group: 'write' },
  { key: 'deleteOwnPost', label: 'Delete own posts', group: 'write' },
  { key: 'editTiles', label: 'Edit tiles', group: 'write' },
];

const ALL_ON = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: true, post: true, deleteOwnPost: true, editTiles: true };

// Preset roles → resolved permission sets. `manage` (settings/members) is owner-only.
export const ROLE_PRESETS = {
  owner: { ...ALL_ON, manage: true },
  editor: { ...ALL_ON, manage: false },
  viewer: { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: true, post: false, deleteOwnPost: false, editTiles: false, manage: false },
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
