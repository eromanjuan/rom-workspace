const TABLES = Object.freeze({
  companies: { domain: 'access', filterColumn: 'id' },
  profiles: { domain: 'access' },
  team_members: { domain: 'access', filterColumn: 'company_id' },
  company_memberships: { domain: 'access' },
  company_subscriptions: { domain: 'access', filterColumn: 'company_id' },
  roles: { domain: 'access', filterColumn: 'company_id' },
  role_permissions: { domain: 'access' },
  user_role_assignments: { domain: 'access', filterColumn: 'company_id' },
  resource_acl: { domain: 'access', filterColumn: 'company_id' },
  field_permissions: { domain: 'access', filterColumn: 'company_id' },
  company_invites: { domain: 'access', filterColumn: 'company_id' },
  company_join_requests: { domain: 'access', filterColumn: 'company_id' },
  company_plugins: { domain: 'access', filterColumn: 'company_id' },
  jobs: { domain: 'operations', filterColumn: 'company_id' },
  tasks: { domain: 'operations', filterColumn: 'company_id' },
  calendar_events: { domain: 'operations', filterColumn: 'company_id' },
  contacts: { domain: 'crm', filterColumn: 'company_id' },
  accounts: { domain: 'crm', filterColumn: 'company_id' },
  deals: { domain: 'crm', filterColumn: 'company_id' },
  pipeline_stages: { domain: 'crm', filterColumn: 'company_id' },
  crm_sites: { domain: 'crm', filterColumn: 'company_id' },
  proposal_documents: { domain: 'crm', filterColumn: 'company_id' },
  activities: { domain: 'crm', filterColumn: 'company_id' },
  job_files: { domain: 'files', filterColumn: 'company_id' },
  forms: { domain: 'forms', filterColumn: 'company_id' },
  form_responses: { domain: 'forms', filterColumn: 'company_id' },
  finance_invoices: { domain: 'finance', filterColumn: 'company_id' },
  finance_payments: { domain: 'finance', filterColumn: 'company_id' },
  finance_expenses: { domain: 'finance', filterColumn: 'company_id' },
  finance_vendors: { domain: 'finance', filterColumn: 'company_id' },
  client_portals: { domain: 'portals', filterColumn: 'company_id' },
  client_portal_documents: { domain: 'portals', filterColumn: 'company_id' },
  client_portal_annotations: { domain: 'portals', filterColumn: 'company_id' },
  client_portal_events: { domain: 'portals', filterColumn: 'company_id' },
  pricebook_vendors: { domain: 'pricebook', filterColumn: 'company_id' },
  pricebook_materials: { domain: 'pricebook', filterColumn: 'company_id' },
  pricebook_vendor_prices: { domain: 'pricebook', filterColumn: 'company_id' },
  notifications: { domain: 'notifications', filterColumn: 'company_id' },
  recycle_bin_items: { domain: 'recycle', filterColumn: 'company_id' },
  workspace_backups: { domain: 'workspace', filterColumn: 'company_id' },
  workspace_builder_state: { domain: 'workspace', filterColumn: 'company_id' },
  message_conversations: { domain: 'messages', dedicated: true },
  message_conversation_access: { domain: 'messages', dedicated: true },
  messages: { domain: 'messages', dedicated: true },
  message_attachments: { domain: 'messages', dedicated: true },
  message_reads: { domain: 'messages', dedicated: true },
  audit_events: { domain: 'audit', dedicated: true },
});

export function realtimeDomainForTable(table) {
  return TABLES[String(table || '')]?.domain || '';
}

export function realtimeSubscriptions(companyIds = []) {
  const companies = [...new Set(companyIds.map(String).filter(Boolean))];
  return Object.entries(TABLES).flatMap(([table, config]) => {
    if (config.dedicated) return [];
    if (!config.filterColumn) return [{ table, domain: config.domain, filter: '' }];
    return companies.map((companyId) => ({
      table,
      domain: config.domain,
      filter: `${config.filterColumn}=eq.${companyId}`,
    }));
  });
}

export function shouldAcceptRealtimePayload(payload, companyIds = []) {
  const config = TABLES[String(payload?.table || '')];
  if (!config || config.dedicated) return false;
  if (!config.filterColumn) return true;
  const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
  const rowCompany = String(row?.[config.filterColumn] || '');
  return !rowCompany || companyIds.map(String).includes(rowCompany);
}

export function shouldDeferRealtimeRefresh(state = {}) {
  return Boolean(
    state.editableFocused
    || state.builderModal
    || state.modal
    || state.recycleModal
    || state.dataLoading
    || state.backgroundRefreshing,
  );
}

export function createRealtimeBatcher({ onFlush, delay = 700, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const pending = new Set();
  let timer = null;
  const flush = () => {
    timer = null;
    if (!pending.size) return;
    const domains = [...pending];
    pending.clear();
    onFlush?.(domains);
  };
  return {
    push(domain) {
      if (!domain) return;
      pending.add(domain);
      if (timer !== null) cancel(timer);
      timer = schedule(flush, delay);
    },
    flush,
    cancel() {
      if (timer !== null) cancel(timer);
      timer = null;
      pending.clear();
    },
  };
}

export function createDeferredDomainAccumulator() {
  const pending = new Set();
  return {
    add(domains = []) {
      domains.filter(Boolean).forEach((domain) => pending.add(domain));
    },
    drain() {
      const domains = [...pending];
      pending.clear();
      return domains;
    },
  };
}
