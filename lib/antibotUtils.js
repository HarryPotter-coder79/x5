// Simple heuristics to detect bot-like accounts
function looksLikeBotFrom({ id = '', name = '' } = {}) {
  const lowerId = (id || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  const combined = `${lowerId} ${lowerName}`;
  if (!combined) return false;

  // Basic patterns
  const patterns = [' bot ', 'bot', 'whatsappbot', 'wa_bot', 'auto', 'automation', 'autobot', 'bot_'];
  for (const p of patterns) {
    if (combined.includes(p)) return true;
  }
  return false;
}

module.exports = { looksLikeBotFrom };
