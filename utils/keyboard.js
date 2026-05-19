/**
 * MTKruto Keyboard Helper
 * MTKruto requires inline keyboard buttons to have a `type` field:
 * - `type: 'callbackData'` for callback buttons
 * - `type: 'url'` for URL buttons
 * This utility auto-infers and adds the type field.
 */

function normalizeButton(btn) {
  if (btn.type) return btn; // already has type
  if (btn.callbackData !== undefined) return { type: 'callbackData', ...btn };
  if (btn.url !== undefined) return { type: 'url', ...btn };
  if (btn.miniApp !== undefined) return { type: 'miniApp', ...btn };
  if (btn.loginUrl !== undefined) return { type: 'loginUrl', ...btn };
  if (btn.switchInlineQuery !== undefined) return { type: 'switchInlineQuery', ...btn };
  return btn;
}

/**
 * Creates a properly formatted MTKruto InlineKeyboard replyMarkup.
 * @param {Array<Array<Object>>} rows - Array of rows, each row is an array of button objects
 * @returns {Object} MTKruto-compatible ReplyMarkupInlineKeyboard
 */
function inlineKeyboard(rows) {
  return {
    type: 'inlineKeyboard',
    inlineKeyboard: rows.map(row => row.map(normalizeButton))
  };
}

module.exports = { inlineKeyboard, normalizeButton };
