// CommonJS-friendly wrappers that dynamically import the ESM Baileys module when needed
let _modPromise = null
function getBaileys() {
  if (!_modPromise) _modPromise = import('@whiskeysockets/baileys')
  return _modPromise
}

module.exports = {
  async downloadContentFromMessage(message, type) {
    const mod = await getBaileys()
    return mod.downloadContentFromMessage(message, type)
  },
  async downloadMediaMessage(message) {
    const mod = await getBaileys()
    return mod.downloadMediaMessage(message)
  },
  delay(ms) {
    return new Promise((res) => setTimeout(res, ms))
  },
  async getContentType(message) {
    const mod = await getBaileys()
    return mod.getContentType(message)
  },
  // expose the full module for advanced needs
  async baileyModule() {
    return await getBaileys()
  }
}
