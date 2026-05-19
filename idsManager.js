const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'ids.json');

/**
 * Ensure the JSON file exists (create empty array if missing)
 */
function ensureFile() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
}

/**
 * Read IDs from the JSON file
 * @returns {number[]} Array of IDs
 */
function readIds() {
  ensureFile();
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error reading IDs:', error);
    return [];
  }
}

/**
 * Write IDs to the JSON file
 * @param {number[]} idsArray
 */
function writeIds(idsArray) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(idsArray, null, 2));
    console.log('✅ IDs saved successfully.');
  } catch (error) {
    console.error('❌ Error writing IDs:', error);
  }
}

/**
 * Load IDs into a local variable (returns array)
 */
function loadIdsToVariable() {
  const ids = readIds();
  console.log('✅ IDs loaded into variable.');
  return ids;
}

// Example usage
// const myIds = loadIdsToVariable();
// console.log(myIds);

module.exports = { readIds, writeIds, loadIdsToVariable };
