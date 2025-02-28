let currentUser = null;

function setAuthHeader() {
    if (!currentUser) return {};
    return {
        'Authorization': 'Basic ' + btoa(`${currentUser.username}:${atob(currentUser.password)}`)
    };
}

async function register() {
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    const response = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const result = await response.json();
    alert(result.message || result.error);
    if (response.ok) window.location.href = 'login.html';
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    console.log('Attempting login:', { username });
    const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const result = await response.json();
    console.log('Login response:', result);
    if (response.ok) {
        currentUser = { username, password: btoa(password), ...result.user };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        console.log('currentUser set:', currentUser);
        if (currentUser.role === 'admin') window.location.href = 'admin.html';
        else window.location.href = 'index.html';
    } else {
        alert(result.error);
    }
}

function logout() {
    console.log('Logging out');
    currentUser = null;
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

async function updateProfile() {
    console.log('updateProfile called, currentUser:', currentUser);
    if (!currentUser) {
        console.log('No currentUser, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    const response = await fetch('/user/profile', { headers: setAuthHeader() });
    const profile = await response.json();
    if (response.ok) {
        document.getElementById('credits').textContent = profile.credits;
        document.getElementById('pastScans').textContent = profile.scans.length ? profile.scans.join(', ') : 'None';
        document.getElementById('creditRequests').textContent = profile.creditRequests.length 
            ? profile.creditRequests.map(r => `${r.amount} credits (${r.status})`).join(', ') 
            : 'None';
        console.log('Profile updated:', profile);
    } else {
        console.log('Profile fetch failed:', profile.error);
        alert(profile.error);
        logout();
    }
}

async function viewFullText(docId) {
    const response = await fetch(`/document/${docId}`, { headers: setAuthHeader() });
    const result = await response.json();
    if (response.ok) {
        alert(`Full Text of Doc ${docId} by ${result.username} (Uploaded: ${new Date(result.timestamp).toLocaleString()}):\n\n${result.text}`);
    } else {
        alert('Failed to load full text: ' + result.error);
    }
}

async function scanDocument() {
    const file = document.getElementById('docUpload').files[0];
    if (!file) return alert('Please upload a file');
    const text = await file.text();
    console.log('Scanning document, text:', text.substring(0, 50) + '...');
    const response = await fetch('/scan', {
        method: 'POST',
        headers: { ...setAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    const result = await response.json();
    console.log('Scan response:', result);
    if (response.ok) {
        updateProfile();
        document.getElementById('matches').innerHTML = '<h3>Matches:</h3>' + 
            (result.matches.length ? result.matches.map(m => `
                <p>Matched with Doc ${m.id} by ${m.username} (Uploaded: ${new Date(m.timestamp).toLocaleString()}): ${m.text} (Similarity: ${m.similarity.toFixed(2)}) 
                <button onclick="viewFullText('${m.id}')">View Full Text</button></p>
            `).join('') : 'No matches found');
    } else {
        alert(result.error);
    }
}

async function requestCredits() {
    const response = await fetch('/credits/request', {
        method: 'POST',
        headers: setAuthHeader()
    });
    const result = await response.json();
    alert(result.message || result.error);
}

async function exportReport() {
    const response = await fetch('/user/export', { headers: setAuthHeader() });
    if (response.ok) {
        const text = await response.text();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scan_history.txt';
        a.click();
        window.URL.revokeObjectURL(url);
    } else {
        alert('Failed to export report');
    }
}

async function adminScanDocument() {
    const file = document.getElementById('adminDocUpload').files[0];
    if (!file) return alert('Please upload a file');
    const text = await file.text();
    console.log('Admin scanning document, text:', text.substring(0, 50) + '...');
    const response = await fetch('/scan', {
        method: 'POST',
        headers: { ...setAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    const result = await response.json();
    console.log('Admin scan response:', result);
    if (response.ok) {
        document.getElementById('adminMatches').innerHTML = '<h3>Matches:</h3>' + 
            (result.matches.length ? result.matches.map(m => `
                <p>Matched with Doc ${m.id} by ${m.username} (Uploaded: ${new Date(m.timestamp).toLocaleString()}): ${m.text} (Similarity: ${m.similarity.toFixed(2)}) 
                <button onclick="viewFullText('${m.id}')">View Full Text</button></p>
            `).join('') : 'No matches found');
        loadAdminDashboard();
    } else {
        alert(result.error);
    }
}

async function loadAdminDashboard() {
    console.log('loadAdminDashboard called, currentUser:', currentUser);
    if (!currentUser || currentUser.role !== 'admin') {
        console.log('Not admin or no currentUser, redirecting');
        logout();
        return;
    }
    const response = await fetch('/admin/analytics', { headers: setAuthHeader() });
    const data = await response.json();
    console.log('Admin analytics data:', data);
    if (!response.ok) {
        console.log('Analytics fetch failed:', data.error);
        alert(data.error);
        return;
    }
    document.getElementById('creditRequests').innerHTML = '<h2>Credit Requests</h2>' + 
        (data.creditRequests && data.creditRequests.length ? data.creditRequests.map(req => `
            <p>${req.username} requests ${req.amount} credits 
            <button onclick="approveCredit('${req.username}', ${req.amount})">Approve</button>
            <button onclick="denyCredit('${req.username}')">Deny</button></p>
        `).join('') : '<p>No pending requests</p>');

    document.getElementById('analytics').innerHTML = `
        <h2>Analytics</h2>
        <p>Total Scans: ${data.totalScans || 0}</p>
        <h3>Scans Per User Today:</h3>
        ${data.scansPerUserPerDay && data.scansPerUserPerDay.length ? data.scansPerUserPerDay.map(u => `<p>${u.username}: ${u.dailyScans} scans</p>`).join('') : '<p>No scans today</p>'}
        <h3>Top Users by Scans:</h3>
        ${data.topUsersByScans && data.topUsersByScans.length ? data.topUsersByScans.map(u => `<p>${u.username}: ${u.totalScans} scans</p>`).join('') : '<p>No data</p>'}
        <h3>Top Users by Credit Usage:</h3>
        ${data.topUsersByCredits && data.topUsersByCredits.length ? data.topUsersByCredits.map(u => `<p>${u.username}: ${u.creditsUsed} credits</p>`).join('') : '<p>No data</p>'}
        <h3>Most Common Topics:</h3>
        ${data.topTopics && data.topTopics.length ? data.topTopics.map(t => `<p>${t.word}: ${t.count} occurrences</p>`).join('') : '<p>No topics</p>'}
        <h3>Credit Usage Stats:</h3>
        <p>Total Credits Used: ${data.creditStats ? data.creditStats.totalCreditsUsed : 0}</p>
        <p>Average Credits Used per User: ${data.creditStats ? data.creditStats.avgCreditsUsed.toFixed(2) : 0}</p>
        <h3>Manual Credit Adjustment:</h3>
        ${data.allUsers && data.allUsers.length ? data.allUsers.map(u => `
            <p>${u.username} (Current: ${u.credits} credits): 
            <input type="number" id="adjust_${u.username}" placeholder="Amount" style="width: 80px;">
            <button onclick="adjustCredit('${u.username}')">Adjust</button></p>
        `).join('') : '<p>No users</p>'}
        <h3>Uploaded Files:</h3>
        ${data.uploadedFiles && data.uploadedFiles.length ? data.uploadedFiles.map(f => `
            <p>Doc ${f.id} by ${f.username} (Scanned: ${new Date(f.timestamp).toLocaleString()}): ${f.text.substring(0, 100)}${f.text.length > 100 ? '...' : ''} 
            <button onclick="viewFullText('${f.id}')">View Full Text</button></p>
        `).join('') : '<p>No uploaded files yet</p>'}
        <h3>Admin Scan:</h3>
        <input type="file" id="adminDocUpload" accept=".txt">
        <button onclick="adminScanDocument()">Scan</button>
        <div id="adminMatches"></div>
        <h3>Recent Activity Logs:</h3>
        ${data.activityLogs && data.activityLogs.length ? data.activityLogs.map(log => `<p>${new Date(log.timestamp).toISOString()}: ${log.username} - ${log.action}${log.docId ? ` (Doc ${log.docId})` : log.amount ? ` (${log.amount} credits)` : ''}</p>`).join('') : '<p>No activity logs</p>'}
    `;
}

async function approveCredit(username, amount) {
    const response = await fetch('/admin/credits/approve', {
        method: 'POST',
        headers: { ...setAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, amount })
    });
    const result = await response.json();
    alert(result.message || result.error);
    loadAdminDashboard();
}

async function denyCredit(username) {
    const response = await fetch('/admin/credits/approve', {
        method: 'POST',
        headers: { ...setAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, amount: 0 })
    });
    loadAdminDashboard();
}

async function adjustCredit(username) {
    const amount = parseInt(document.getElementById(`adjust_${username}`).value) || 0;
    const response = await fetch('/admin/credits/adjust', {
        method: 'POST',
        headers: { ...setAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, amount })
    });
    const result = await response.json();
    alert(result.message || result.error);
    loadAdminDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
    currentUser = JSON.parse(localStorage.getItem('currentUser'));
    console.log('DOMContentLoaded, currentUser:', currentUser);
    if (window.location.pathname.includes('index.html') && currentUser) {
        updateProfile();
    } else if (window.location.pathname.includes('admin.html') && currentUser && currentUser.role === 'admin') {
        loadAdminDashboard();
    } else if (!window.location.pathname.includes('login.html') && !window.location.pathname.includes('register.html') && !currentUser) {
        window.location.href = 'login.html';
    }
});