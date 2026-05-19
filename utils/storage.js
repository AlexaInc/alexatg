const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'groups.json');
const userIdsPath = path.join(__dirname, '..', 'users.json');

function loadGroupIds() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            const ids = JSON.parse(data);
            if (Array.isArray(ids)) {
                console.log(`Loaded ${ids.length} group IDs from ${DB_FILE}`);
                return new Set(ids);
            }
        }
        return new Set();
    } catch (error) {
        console.error(`Error loading ${DB_FILE}: ${error.message}`);
        return new Set();
    }
}

function saveGroupIds(groupChatIds) {
    try {
        const idsArray = [...groupChatIds];
        const data = JSON.stringify(idsArray, null, 2);
        fs.writeFileSync(DB_FILE, data, 'utf8');
    } catch (error) {
        console.error(`Error saving ${DB_FILE}: ${error.message}`);
    }
}

function saveUserIds(userChatIds) {
    try {
        fs.writeFileSync(userIdsPath, JSON.stringify([...userChatIds], null, 2));
    } catch (error) {
        console.error(`Error saving ${userIdsPath}: ${error.message}`);
    }
}

function loadUserIds() {
    try {
        if (fs.existsSync(userIdsPath)) {
            return new Set(JSON.parse(fs.readFileSync(userIdsPath)));
        }
        return new Set();
    } catch (error) {
        console.error(`Error loading ${userIdsPath}: ${error.message}`);
        return new Set();
    }
}

module.exports = {
    loadGroupIds,
    saveGroupIds,
    saveUserIds,
    loadUserIds
};
