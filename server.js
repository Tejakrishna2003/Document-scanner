const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');

// Load data from file or initialize
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { users: [], documents: [], creditRequests: [], activityLogs: [] };
    }
}

async function saveData(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Simple password hashing (base64 for demo)
function hashPassword(password) {
    return Buffer.from(password).toString('base64');
}

// Middleware to check authentication
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    loadData().then(data => {
        const user = data.users.find(u => u.username === username && u.password === hashPassword(password));
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        req.user = user;
        next();
    });
}

// Default route to login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API Endpoints
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    const data = await loadData();
    if (data.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    const user = { username, password: hashPassword(password), credits: 20, scans: [], role: 'user', creditsUsed: 0 };
    data.users.push(user);
    data.activityLogs.push({ username, action: 'register', timestamp: new Date() });
    await saveData(data);
    res.status(201).json({ message: 'Registration successful' });
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const data = await loadData();
    const user = data.users.find(u => u.username === username && u.password === hashPassword(password));
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    data.activityLogs.push({ username, action: 'login', timestamp: new Date() });
    await saveData(data);
    res.json({ message: 'Login successful', user: { username, credits: user.credits, role: user.role } });
});

app.get('/user/profile', authenticate, async (req, res) => {
    const data = await loadData();
    const userRequests = data.creditRequests.filter(r => r.username === req.user.username);
    res.json({
        username: req.user.username,
        credits: req.user.credits,
        scans: req.user.scans,
        role: req.user.role,
        creditRequests: userRequests
    });
});

app.post('/scan', authenticate, async (req, res) => {
    const { text } = req.body;
    console.log('Scan request received, user:', req.user.username, 'credits:', req.user.credits);
    const data = await loadData();
    if (req.user.role !== 'admin' && req.user.credits <= 0) {
        console.log('No credits available for', req.user.username);
        return res.status(403).json({ error: 'No credits available' });
    }
    if (req.user.role !== 'admin') req.user.credits--;
    req.user.creditsUsed = (req.user.creditsUsed || 0) + 1;
    const docId = Date.now().toString();
    const doc = { id: docId, text, username: req.user.username, timestamp: new Date() };
    data.documents.push(doc);
    req.user.scans.push(docId);
    const userIndex = data.users.findIndex(u => u.username === req.user.username);
    data.users[userIndex] = req.user;
    data.activityLogs.push({ username: req.user.username, action: 'scan', docId, timestamp: new Date() });
    await saveData(data);
    console.log('Scan completed, new credits:', req.user.credits);
    const matches = findMatches(text, data.documents.filter(d => d.username !== req.user.username));
    const detailedMatches = matches.map(match => {
        const matchedDoc = data.documents.find(d => d.id === match.id);
        return {
            id: match.id,
            username: matchedDoc.username,
            timestamp: matchedDoc.timestamp,
            text: match.text,
            similarity: match.similarity
        };
    });
    res.json({ message: 'Scan successful', matches: detailedMatches, credits: req.user.credits });
});

app.get('/matches/:docId', authenticate, async (req, res) => {
    const { docId } = req.params;
    const data = await loadData();
    const doc = data.documents.find(d => d.id === docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const matches = findMatches(doc.text, data.documents.filter(d => d.username !== req.user.username));
    const detailedMatches = matches.map(match => {
        const matchedDoc = data.documents.find(d => d.id === match.id);
        return {
            id: match.id,
            username: matchedDoc.username,
            timestamp: matchedDoc.timestamp,
            text: match.text,
            similarity: match.similarity
        };
    });
    res.json({ matches: detailedMatches });
});

app.post('/credits/request', authenticate, async (req, res) => {
    const data = await loadData();
    data.creditRequests.push({ username: req.user.username, amount: 10, status: 'pending', timestamp: new Date() });
    data.activityLogs.push({ username: req.user.username, action: 'request_credits', amount: 10, timestamp: new Date() });
    await saveData(data);
    res.json({ message: 'Credit request submitted' });
});

app.get('/admin/analytics', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const data = await loadData();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scansPerUserPerDay = data.users.map(u => {
        const dailyScans = data.documents.filter(d => 
            d.username === u.username && new Date(d.timestamp) >= today
        ).length;
        return { username: u.username, dailyScans, totalScans: u.scans.length, creditsUsed: u.creditsUsed || 0, credits: u.credits };
    });
    const allWords = data.documents.flatMap(d => d.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordFreq = {};
    allWords.forEach(w => wordFreq[w] = (wordFreq[w] || 0) + 1);
    const topTopics = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word, count]) => ({ word, count }));
    const topUsersByScans = scansPerUserPerDay.sort((a, b) => b.totalScans - a.totalScans).slice(0, 5);
    const topUsersByCredits = scansPerUserPerDay.sort((a, b) => b.creditsUsed - a.creditsUsed).slice(0, 5);
    const totalCreditsUsed = scansPerUserPerDay.reduce((sum, u) => sum + u.creditsUsed, 0);
    const avgCreditsUsed = totalCreditsUsed / (data.users.length || 1);
    const recentLogs = data.activityLogs.slice(-10);
    res.json({
        totalScans: data.documents.length,
        scansPerUserPerDay,
        topUsersByScans,
        topUsersByCredits,
        creditRequests: data.creditRequests,
        topTopics,
        creditStats: { totalCreditsUsed, avgCreditsUsed },
        allUsers: scansPerUserPerDay,
        activityLogs: recentLogs,
        uploadedFiles: data.documents
    });
});

app.post('/admin/credits/approve', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const { username, amount } = req.body;
    const data = await loadData();
    const user = data.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.credits += amount;
    data.creditRequests = data.creditRequests.filter(r => r.username !== username);
    data.activityLogs.push({ username, action: amount > 0 ? 'approve_credits' : 'deny_credits', amount, timestamp: new Date() });
    await saveData(data);
    res.json({ message: `Approved ${amount} credits for ${username}` });
});

app.post('/admin/credits/adjust', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const { username, amount } = req.body;
    const data = await loadData();
    const user = data.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.credits = Math.max(0, user.credits + amount);
    data.activityLogs.push({ username, action: 'adjust_credits', amount, timestamp: new Date() });
    await saveData(data);
    res.json({ message: `Adjusted ${amount} credits for ${username}, new balance: ${user.credits}` });
});

app.get('/user/export', authenticate, async (req, res) => {
    const data = await loadData();
    const userDocs = data.documents.filter(d => d.username === req.user.username);
    const report = userDocs.map(d => `Doc ${d.id} (Scanned: ${new Date(d.timestamp).toISOString()}): ${d.text}`).join('\n');
    res.set('Content-Type', 'text/plain');
    res.send(report);
});

// New endpoint to retrieve full document text
app.get('/document/:docId', authenticate, async (req, res) => {
    const { docId } = req.params;
    const data = await loadData();
    const doc = data.documents.find(d => d.id === docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ id: doc.id, username: doc.username, timestamp: doc.timestamp, text: doc.text });
});

// Text Matching Logic
function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]) + 1;
            }
        }
    }
    return dp[m][n];
}

function getWordFrequency(text) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const freq = {};
    words.forEach(word => freq[word] = (freq[word] || 0) + 1);
    return freq;
}

function cosineSimilarity(freq1, freq2) {
    const allWords = new Set([...Object.keys(freq1), ...Object.keys(freq2)]);
    let dotProduct = 0, mag1 = 0, mag2 = 0;
    for (const word of allWords) {
        const v1 = freq1[word] || 0;
        const v2 = freq2[word] || 0;
        dotProduct += v1 * v2;
        mag1 += v1 * v1;
        mag2 += v2 * v2;
    }
    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);
    return mag1 && mag2 ? dotProduct / (mag1 * mag2) : 0;
}

function findMatches(text, documents) {
    const textFreq = getWordFrequency(text);
    return documents
        .map(doc => {
            const docFreq = getWordFrequency(doc.text);
            const levDistance = levenshteinDistance(text, doc.text);
            const maxLen = Math.max(text.length, doc.text.length);
            const levSimilarity = 1 - (levDistance / maxLen);
            const wordFreqSimilarity = cosineSimilarity(textFreq, docFreq);
            const combinedSimilarity = 0.4 * levSimilarity + 0.6 * wordFreqSimilarity;
            return {
                id: doc.id,
                similarity: combinedSimilarity,
                text: doc.text.substring(0, 100) + (doc.text.length > 100 ? '...' : '')
            };
        })
        .filter(match => match.similarity > 0.5)
        .sort((a, b) => b.similarity - a.similarity);
}

// Daily Credit Reset at Midnight
function scheduleDailyReset() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timeToMidnight = midnight - now;

    setTimeout(async () => {
        try {
            const data = await loadData();
            data.users.forEach(u => u.credits = 20);
            data.activityLogs.push({ username: 'system', action: 'credit_reset', timestamp: new Date() });
            await saveData(data);
            console.log('Credits reset to 20 for all users at midnight:', new Date().toISOString());
            setInterval(async () => {
                try {
                    const data = await loadData();
                    data.users.forEach(u => u.credits = 20);
                    data.activityLogs.push({ username: 'system', action: 'credit_reset', timestamp: new Date() });
                    await saveData(data);
                    console.log('Credits reset to 20 for all users at midnight:', new Date().toISOString());
                } catch (error) {
                    console.error('Reset interval failed:', error);
                }
            }, 24 * 60 * 60 * 1000);
        } catch (error) {
            console.error('Initial reset failed:', error);
        }
    }, timeToMidnight);
}
scheduleDailyReset();

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});