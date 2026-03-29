const fs = require('fs').promises;
const path = require('path');

const aicountFilePath = path.join(__dirname, '..', 'aicount.json');
const DEFAULT_DAILY_LIMIT = 20;

/**
 * Reads the count file, checks/resets daily counts, checks user limit,
 * and increments the count for a specific user.
 */
async function updateUserCount_Optimized(userId) {
    const todayDateString = new Date().toISOString().split('T')[0];

    let data = {
        lastResetDate: todayDateString,
        dailyLimit: DEFAULT_DAILY_LIMIT,
        counts: {}
    };

    try {
        const fileContents = await fs.readFile(aicountFilePath, 'utf8');
        data = JSON.parse(fileContents);

        if (typeof data.counts !== 'object' || Array.isArray(data.counts) || !data.lastResetDate) {
            data.counts = {};
        }
        if (typeof data.dailyLimit === 'undefined') {
            data.dailyLimit = DEFAULT_DAILY_LIMIT;
        }
    } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
            console.error('Error reading aicount.json:', error);
            return false;
        }
    }

    if (data.lastResetDate !== todayDateString) {
        data.counts = {};
        data.lastResetDate = todayDateString;
    }

    const currentCount = data.counts[userId] || 0;
    const currentLimit = data.dailyLimit;

    if (currentCount >= currentLimit) {
        await fs.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
        return false;
    }

    data.counts[userId] = currentCount + 1;
    try {
        await fs.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing to aicount.json:', error);
        return false;
    }
}

/**
 * Checks the current usage count and daily limit for a user.
 */
async function checkUserCount(userId) {
    const todayDateString = new Date().toISOString().split('T')[0];

    try {
        const fileContents = await fs.readFile(aicountFilePath, 'utf8');
        const data = JSON.parse(fileContents);
        const dailyLimit = data.dailyLimit || DEFAULT_DAILY_LIMIT;

        if (data.lastResetDate !== todayDateString) {
            return { currentCount: 0, dailyLimit: dailyLimit };
        }

        const currentCount = data.counts[userId] || 0;
        return { currentCount: currentCount, dailyLimit: dailyLimit };
    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            return { currentCount: 0, dailyLimit: DEFAULT_DAILY_LIMIT };
        } else {
            console.error('Error reading aicount.json for check:', error);
            throw new Error('Could not check user count.');
        }
    }
}

/**
 * Updates the global daily limit for all users.
 */
async function updateUserLimit(newLimit) {
    try {
        const fileContents = await fs.readFile(aicountFilePath, 'utf8');
        const data = JSON.parse(fileContents);
        data.dailyLimit = newLimit;
        await fs.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            const todayDateString = new Date().toISOString().split('T')[0];
            const data = {
                lastResetDate: todayDateString,
                dailyLimit: newLimit,
                counts: {}
            };
            await fs.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        }
        console.error('Error updating daily limit:', error);
        return false;
    }
}

module.exports = {
    updateUserCount_Optimized,
    checkUserCount,
    updateUserLimit,
    DEFAULT_DAILY_LIMIT
};
