// services/crmStub.js
// Заготовка интеграции с CRM: сейчас только логирует вызовы

export function sendLeadToCRM(lead, maskContact) {
  try {
    const masked = lead?.contact?.value ? maskContact(lead.contact) : '***';
    const channel = lead?.contact?.channel || 'n/a';
    console.log(`📤 [CRM-STUB] leadId=${lead?.id} channel=${channel} contact=${masked}`);
  } catch (e) {
    console.warn('CRM stub error (ignored):', e?.message || e);
  }
}

export default { sendLeadToCRM };


