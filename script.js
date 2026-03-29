// Gifsk Wiki Script - Wikipedia-like encyclopedia platform with Argn media support

// Data storage - uses hierarchical path-based keys like Argn
// Example structure:
// articles = {
//   "gifstad/overview": { path: "gifstad/overview", title: "...", ... },
//   "gifsk/projects": { path: "gifsk/projects", title: "...", ... },
//   "general/test": { path: "general/test", title: "...", ... }
// }

// Detect if we're in admin mode early and reliably
const IS_ADMIN_PAGE = (() => {
    try {
        if (document.title && document.title.includes('Admin')) return true;
        if (document.getElementById('jsonEditorView')) return true;
        return false;
    } catch (e) {
        return false;
    }
})();

// Load articles: 
// - Public: articles.json ONLY (read-only)
// - Admin: articles.json + localStorage merged
let articles = {}; // Will be populated after DOM loads

function loadArticles() {
    let base = {};
    
    // Always load from articles.json as base
    try {
        const req = new XMLHttpRequest();
        req.open('GET', '/articles.json', false); // sync
        req.send();
        if (req.status === 200) {
            base = JSON.parse(req.responseText);
        }
    } catch (e) {
        console.warn('Failed to load articles.json', e);
    }
    
    // If there are articles saved in localStorage (admin edits), merge them on top
    // This makes admin-created articles visible on public pages when present.
    try {
        const storedRaw = localStorage.getItem('gifskArticles');
        const stored = storedRaw ? (JSON.parse(storedRaw) || {}) : {};
        if (stored && Object.keys(stored).length > 0) {
            base = Object.assign(base, stored); // localStorage overwrites articles.json
        }
    } catch (e) {
        console.warn('Failed to load localStorage articles', e);
    }
    
    articles = base;
    console.log('Articles loaded:', Object.keys(articles).length);
}

// Resolve article path with fallbacks: exact match, slug match, title match
function resolveArticlePath(path) {
    if (!path) return null;
    if (articles[path]) return path;
    const slug = path.split('/').pop();
    // Try slug-only matches or title matches
    for (const k of Object.keys(articles)) {
        if (k === slug) return k;
        if (k.endsWith('/' + slug)) return k;
        const a = articles[k];
        if (a && a.title) {
            if (a.title.toLowerCase() === decodeURIComponent(path).toLowerCase()) return k;
            if (a.title.toLowerCase() === slug.toLowerCase()) return k;
        }
    }
    return null;
}

// --- Debug instrumentation (captures errors and key actions to localStorage - admin only)
function pushActionLog(entry) {
    if (!IS_ADMIN_PAGE) return; // Public site doesn't log
    try {
        const key = 'gifskActionLog';
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        list.push({ ts: new Date().toISOString(), entry });
        localStorage.setItem(key, JSON.stringify(list.slice(-200)));
    } catch (e) {
        console.warn('Failed to push action log', e);
    }
}

function pushErrorLog(err) {
    if (!IS_ADMIN_PAGE) return; // Public site doesn't log
    try {
        const key = 'gifskLastErrors';
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        list.push(Object.assign({ ts: new Date().toISOString() }, err));
        localStorage.setItem(key, JSON.stringify(list.slice(-50)));
    } catch (e) {
        console.warn('Failed to push error log', e);
    }
}

window.addEventListener('error', (ev) => {
    try {
        pushErrorLog({ message: ev.message, filename: ev.filename, lineno: ev.lineno, colno: ev.colno });
    } catch (e) {}
});

window.addEventListener('unhandledrejection', (ev) => {
    try {
        const reason = (ev && ev.reason && ev.reason.message) ? ev.reason.message : String(ev.reason);
        pushErrorLog({ message: 'UnhandledRejection: ' + reason });
    } catch (e) {}
});

// Log history/navigation events
const originalPushState = window.history.pushState;
window.history.pushState = function(state, title, url) {
    try { pushActionLog({ type: 'pushState', url, title, state }); } catch (e) {}
    return originalPushState.apply(this, arguments);
};

let mediaLibrary = JSON.parse(localStorage.getItem('gifskMedia')) || [];
let argMediaLibrary = [];
let argnArticleTitles = [];
let currentArticlePath = ''; // Track full path like "gifstad/article-name"
let isEditing = false;
let recentChanges = JSON.parse(localStorage.getItem('gifskRecentChanges')) || [];

// Safe DOM text setter to avoid runtime errors when elements are missing
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Convert wiki-style links [[path]] or [[path|text]] to markdown links
function processWikiLinks(content) {
    return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, path, displayText) => {
        path = path.trim();
        displayText = displayText ? displayText.trim() : null;
        
        // If no display text, try to get article title
        if (!displayText && articles[path]) {
            displayText = articles[path].title;
        }
        
        // Fallback to path if no title found
        displayText = displayText || path;
        
        // Create markdown link (convert path to route)
        const route = '/' + path;
        return `[${displayText}](${route})`;
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Gifsk Wiki Initializing...');
        loadArticles(); // Load articles first
        console.log('Articles loaded:', Object.keys(articles).length);
        // Run non-blocking init tasks with guards so one error doesn't stop the rest
        try { loadArgnIndex(); } catch (e) { console.warn('loadArgnIndex failed', e); }
        try { loadArgMedia(); } catch (e) { console.warn('loadArgMedia failed', e); }
        try { setupEventListeners(); } catch (e) { console.warn('setupEventListeners failed', e); }
        try { handleInitialRoute(); } catch (e) { console.warn('handleInitialRoute failed', e); }
        try { setupPopstateHandler(); } catch (e) { console.warn('setupPopstateHandler failed', e); }
        console.log('✓ All systems ready!');
    } catch (err) {
        console.error('Initialization error:', err);
    }
});

// ============ URL ROUTING (like Argn) ============
function handleInitialRoute() {
    try {
        console.log('handleInitialRoute called, IS_ADMIN_PAGE=', IS_ADMIN_PAGE);
        let pathname = '';

        if (IS_ADMIN_PAGE && window.location.hash) {
            pathname = window.location.hash.replace(/^#/, '').replace(/\/+$/, '').replace(/^\/$/, '');
        } else {
            pathname = window.location.pathname.replace(/\/+$/, '').replace(/^\/$/, '');
        }

        if (!pathname) {
            showHome();
            return;
        }
        
        const parts = pathname.split('/').filter(p => p);
        
        if (parts.length === 2) {
            const path = parts.join('/');
            const resolved = resolveArticlePath(path);
            if (resolved) {
                currentArticlePath = resolved;
                viewArticle();
                return;
            }
        }
        
        if (parts.length === 1) {
            const route = parts[0];
            if (route === 'categories') { showCategories(); return; }
            if (route === 'help') { showHelp(); return; }
            if (route === 'all-articles') { listArticles(); return; }
            if (route === 'recent') { showRecent(); return; }
        }
        
        showHome();
    } catch (err) {
        console.error('handleInitialRoute error', err && err.message);
        pushErrorLog({ message: 'handleInitialRoute: ' + (err && err.message) });
        try { showHome(); } catch (e2) { console.error('showHome also failed', e2); }
    }
}

function setupPopstateHandler() {
    try {
        window.addEventListener('popstate', (event) => {
            try {
                console.log('Popstate event triggered');
                handleInitialRoute();
            } catch (err) {
                console.error('popstate handler error', err && err.message);
                pushErrorLog({ message: 'popstate: ' + (err && err.message) });
            }
        });
        
        if (IS_ADMIN_PAGE) {
            window.addEventListener('hashchange', () => {
                try {
                    console.log('Hashchange event triggered (admin)');
                    handleInitialRoute();
                } catch (err) {
                    console.error('hashchange handler error', err && err.message);
                    pushErrorLog({ message: 'hashchange: ' + (err && err.message) });
                }
            });
        }
    } catch (err) {
        console.error('setupPopstateHandler error', err && err.message);
        pushErrorLog({ message: 'setupPopstateHandler: ' + (err && err.message) });
    }
}

function updateURL(path) {
    try {
        const cleanPath = (path || '').replace(/^\//, '').replace(/\/$/, '');

        if (IS_ADMIN_PAGE) {
            // Use hash so server won't receive path on refresh
            if (!cleanPath || cleanPath === 'home') {
                window.location.hash = '';
            } else {
                window.location.hash = '#' + cleanPath;
            }
            return;
        }

        // Normal pushState routing for public pages
        if (cleanPath === '' || cleanPath === 'home') {
            window.history.pushState({ view: 'home' }, 'Gifsk Wiki', '/');
        } else if (cleanPath === 'categories') {
            window.history.pushState({ view: 'categories' }, 'Categories', '/categories');
        } else if (cleanPath === 'all-articles') {
            window.history.pushState({ view: 'all-articles' }, 'All Articles', '/all-articles');
        } else if (cleanPath === 'recent') {
            window.history.pushState({ view: 'recent' }, 'Recent Changes', '/recent');
        } else {
            window.history.pushState({ path: cleanPath }, cleanPath, '/' + cleanPath);
        }
    } catch (err) {
        console.error('updateURL error', err && err.message);
        pushErrorLog({ message: 'updateURL: ' + (err && err.message) });
    }
}

// Help / Guidelines view
// Help view removed for release

function setupEventListeners() {
    const searchInput = document.getElementById('mainSearch');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch(searchInput.value);
            }
        });
    }

    const argnSearchInput = document.getElementById('argnSearchInput');
    if (argnSearchInput) {
        argnSearchInput.addEventListener('input', () => updateArgnSuggestions(argnSearchInput.value));
    }

    // Delegate clicks on article rows and wiki links
    document.addEventListener('click', (e) => {
        try {
            // Handle article row clicks
            const row = e.target.closest && e.target.closest('.article-row');
            if (row && row.dataset && row.dataset.path) {
                e.preventDefault();
                viewArticleByPath(row.dataset.path);
                return;
            }
            
            // Handle wiki link clicks (links to article paths like /gifstad/overview)
            const link = e.target.closest && e.target.closest('a[href^="/"]');
            if (link && link.href) {
                const path = link.href.replace(/^.*?:\/\/[^/]+/, '').replace(/^\//, '');
                // Only handle if it looks like an article path (contains /)
                if (path.includes('/') && articles[path]) {
                    e.preventDefault();
                    if (IS_ADMIN_PAGE) {
                        window.location.hash = '#' + path;
                    } else {
                        window.history.pushState({ path }, '', '/' + path);
                    }
                    viewArticleByPath(path);
                    return;
                }
            }
        } catch (err) {
            // swallow delegation errors
        }
    });
}

// ============ HOME VIEW ============
function showHome() {
    updateURL('home');
    // Reload articles in case they were updated
    loadArticles();
    hideAllViews();
    const container = document.getElementById('viewContainer');
    container.classList.remove('hidden');
    
    const articleCount = Object.keys(articles).length;
    
    container.innerHTML = `
        <div class="home-view">
            <div style="text-align: center; margin: 40px 0;">
                <h1 style="font-size: 48px; color: #fff; margin-bottom: 10px;">Gifsk Wiki</h1>
                <p style="font-size: 18px; color: #a0b0d0;">Free Encyclopedia - Build by the Community</p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 40px 0;">
                <div style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 6px; padding: 20px; text-align: center;">
                    <h3 style="color: #fff; font-size: 24px; margin-bottom: 10px;">${articleCount}</h3>
                    <p style="color: #a0b0d0;">Articles</p>
                </div>
                <div style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 6px; padding: 20px; text-align: center;">
                    <h3 style="color: #fff; font-size: 24px; margin-bottom: 10px;">${recentChanges.length}</h3>
                    <p style="color: #a0b0d0;">Recent Changes</p>
                </div>
            </div>

            <div style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 6px; padding: 20px; margin: 20px 0;">
                <h2 style="color: #fff; margin-bottom: 15px;">Featured Articles</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px;">
                    ${getRandomArticles(4).length > 0 ? getRandomArticles(4).map(path => `
                        <div onclick="viewArticleByPath('${path}')" style="background-color: #0f1b35; border: 1px solid #3a5a7a; padding: 15px; border-radius: 4px; cursor: pointer; transition: all 0.3s; text-align: center;">
                            <h4 style="color: #5a9adf; margin-bottom: 8px; font-size: 14px;">${articles[path]?.title || 'Untitled'}</h4>
                            <p style="color: #7a8aaa; font-size: 12px;">${path.split('/')[0]}</p>
                        </div>
                    `).join('') : '<p style="color: #a0b0d0; grid-column: 1/-1; text-align: center; padding: 20px;">No articles yet</p>'}
                </div>
            </div>

            <div style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 6px; padding: 20px; margin: 20px 0;">
                <h2 style="color: #fff; margin-bottom: 15px;">Quick Links</h2>
                <ul style="list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                    <li><a href="#" onclick="listArticles()" style="color: #5a9adf; text-decoration: none; padding: 10px; display: block; border-radius: 4px; transition: all 0.3s;" onmouseover="this.style.backgroundColor='#2a3a5a'" onmouseout="this.style.backgroundColor='transparent'">Browse All Articles</a></li>
                    ${IS_ADMIN_PAGE ? '<li><a href="#" onclick="createNewArticle()" style="color: #5a9adf; text-decoration: none; padding: 10px; display: block; border-radius: 4px; transition: all 0.3s;" onmouseover="this.style.backgroundColor=\'#2a3a5a\'" onmouseout="this.style.backgroundColor=\'transparent\'">Create an Article</a></li>' : ''}
                    <li><a href="#" onclick="showCategories()" style="color: #5a9adf; text-decoration: none; padding: 10px; display: block; border-radius: 4px; transition: all 0.3s;" onmouseover="this.style.backgroundColor='#2a3a5a'" onmouseout="this.style.backgroundColor='transparent'">Browse Categories</a></li>
                </ul>
            </div>
        </div>
    `;
}

function getRandomArticles(count) {
    const paths = Object.keys(articles);
    return paths.sort(() => Math.random() - 0.5).slice(0, count);
}

// ============ ARTICLE MANAGEMENT ============
function createNewArticle() {
    const createEl = document.getElementById('createView');
    if (!createEl) {
        // Create view only exists in admin panel — open admin in new tab anchored to create
        const adminUrl = 'admin.html#create';
        window.open(adminUrl, '_blank');
        return;
    }
    hideAllViews();
    createEl.classList.remove('hidden');
}

function submitNewArticle(event) {
    event.preventDefault();
    const titleEl = document.getElementById('newTitle');
    const categoryEl = document.getElementById('newCategory');
    const contentEl = document.getElementById('newContent');

    if (!titleEl || !categoryEl || !contentEl) {
        // If the create form isn't present (public site), forward user to admin create
        const adminUrl = 'admin.html#create';
        window.open(adminUrl, '_blank');
        return;
    }

    const title = titleEl.value;
    const category = categoryEl.value;
    const content = contentEl.value;
    
    if (!title.trim()) {
        alert('Please enter an article title');
        return;
    }
    
    // Create path: category/article-slug
    const articleSlug = generateSlug(title);
    const path = `${category || 'gifsk'}/${articleSlug}`;
    
    if (articles[path]) {
        alert('An article already exists at this path');
        return;
    }
    
    articles[path] = {
        path: path,
        title: title,
        content: content,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        sidebarImage: '',
        sidebarFields: []
    };
    
    saveArticles();
    logChange('create', path, title);
    
    alert('Article created successfully!');
    viewArticleByPath(path);
}

function viewArticleByPath(path) {
    const resolved = resolveArticlePath(path);
    if (!resolved) {
        console.error('Article not found: ' + path);
        showHome();
        return;
    }

    currentArticlePath = resolved;
    isEditing = false;
    updateURL(path);
    viewArticle();
}

function viewArticle() {
    if (!currentArticlePath || !articles[currentArticlePath]) {
        alert('No article selected');
        return;
    }
    
    isEditing = false;
    hideAllViews();
    document.getElementById('articleView').classList.remove('hidden');
    
    const article = articles[currentArticlePath];
    const pathParts = currentArticlePath.split('/');
    const category = pathParts[0];
    
    // Ensure sidebarFields exists as an array
    if (!article.sidebarFields) {
        article.sidebarFields = [];
    }

    safeSetText('articleTitle', article.title);
    safeSetText('articleCategory', category);
    const _articleCategoryEl = document.getElementById('articleCategory');
    if (_articleCategoryEl) _articleCategoryEl.className = 'category-tag';
    safeSetText('articleLastEdit', `Last edited: ${formatDate(article.lastModified)}`);

    // Add/share and quote buttons so users can copy a link or a quoted excerpt
    try {
        const header = document.querySelector('.article-header');
        if (header) {
            let shareBtn = document.getElementById('shareArticleBtn');
            if (!shareBtn) {
                shareBtn = document.createElement('button');
                shareBtn.id = 'shareArticleBtn';
                shareBtn.className = 'btn btn-secondary';
                shareBtn.style.marginLeft = '8px';
                shareBtn.textContent = 'Share';
                shareBtn.onclick = () => copyArticleLink(currentArticlePath);
                const meta = header.querySelector('.article-meta');
                if (meta) meta.appendChild(shareBtn);
                else header.appendChild(shareBtn);
            } else {
                shareBtn.onclick = () => copyArticleLink(currentArticlePath);
            }

            // Quote button: copies a markdown blockquote with attribution, and inserts into editor if open
            let quoteBtn = document.getElementById('quoteArticleBtn');
            if (!quoteBtn) {
                quoteBtn = document.createElement('button');
                quoteBtn.id = 'quoteArticleBtn';
                quoteBtn.className = 'btn btn-secondary';
                quoteBtn.style.marginLeft = '8px';
                quoteBtn.textContent = 'Quote';
                quoteBtn.onclick = () => quoteArticle(currentArticlePath);
                const meta2 = header.querySelector('.article-meta');
                if (meta2) meta2.appendChild(quoteBtn);
                else header.appendChild(quoteBtn);
            } else {
                quoteBtn.onclick = () => quoteArticle(currentArticlePath);
            }
        }
    } catch (e) {
        // non-fatal
    }

    // Set sidebar image
    const sidebarImage = document.getElementById('sidebarImage');
    if (sidebarImage) {
        if (article.sidebarImage && article.sidebarImage.trim()) {
            sidebarImage.src = article.sidebarImage;
            sidebarImage.style.display = 'block';
            sidebarImage.onerror = function() {
                this.style.display = 'none';
            };
        } else {
            sidebarImage.style.display = 'none';
        }
    }

    safeSetText('sidebarCategory', category);
    safeSetText('sidebarCreated', formatDate(article.createdAt));
    safeSetText('sidebarUpdated', formatDate(article.lastModified));

    // Render custom sidebar fields
    const customFieldsContainer = document.getElementById('sidebarCustomFields');
    if (customFieldsContainer) {
        customFieldsContainer.innerHTML = '';
        if (article.sidebarFields && article.sidebarFields.length > 0) {
            article.sidebarFields.forEach(field => {
                const p = document.createElement('p');
                p.innerHTML = `<strong>${field.label}:</strong> ${field.value}`;
                customFieldsContainer.appendChild(p);
            });
        }
    }

    // Update sidebar image input if it exists
    const sidebarImageInput = document.getElementById('sidebarImageInput');
    if (sidebarImageInput) {
        sidebarImageInput.value = article.sidebarImage || '';
    }
    
    // Only show edit on admin pages
    const editSidebarBtn = document.getElementById('editSidebarBtn');
    if (editSidebarBtn) {
        const isAdminPage = window.location.href.includes('admin.html') || 
                           document.title.includes('Admin');
        editSidebarBtn.style.display = isAdminPage ? 'block' : 'none';
    }
    
    const sidebarEditPanel = document.getElementById('sidebarEditPanel');
    if (sidebarEditPanel) {
        sidebarEditPanel.classList.add('hidden');
    }

    // Parse and display markdown (with wiki-style link processing)
    const processedContent = processWikiLinks(article.content || '');
    const renderedContent = marked.parse(processedContent);
    const articleContentEl = document.getElementById('articleContent');
    if (articleContentEl) articleContentEl.innerHTML = renderedContent;
    safeSetText('articleMarkdownSource', article.content || '');

    const editContentEl = document.getElementById('editContent');
    if (editContentEl) {
        editContentEl.value = article.content;
        editContentEl.classList.add('hidden');
    }
    const editorToolbarEl = document.getElementById('editorToolbar');
    if (editorToolbarEl) editorToolbarEl.classList.add('hidden');
    const articleMarkdownSourceEl = document.getElementById('articleMarkdownSource');
    if (articleMarkdownSourceEl) articleMarkdownSourceEl.classList.add('hidden');

    const editBtnEl = document.getElementById('editBtn');
    if (editBtnEl) editBtnEl.style.display = 'inline-block';
    const viewBtnEl = document.getElementById('viewBtn');
    if (viewBtnEl) viewBtnEl.style.display = 'none';
    const saveBtnEl = document.getElementById('saveBtn');
    if (saveBtnEl) saveBtnEl.style.display = 'none';
    const cancelBtnEl = document.getElementById('cancelBtn');
    if (cancelBtnEl) cancelBtnEl.style.display = 'none';
}

function copyArticleLink(path) {
    if (!path) return;
    // Use hash-based link so GitHub Pages won't 404 on refresh
    try {
        const origin = window.location.origin.replace(/:\d+$/, '');
        const shareUrl = origin + '/#' + path;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(() => {
                alert('Article link copied to clipboard:\n' + shareUrl);
            }).catch(() => {
                prompt('Copy this link:', shareUrl);
            });
        } else {
            prompt('Copy this link:', shareUrl);
        }
    } catch (e) {
        const fallback = window.location.origin + '/#' + path;
        prompt('Copy this link:', fallback);
    }
}

function editArticle() {
    isEditing = true;

    document.getElementById('articleContent').classList.add('hidden');
    document.getElementById('articleMarkdownSource').classList.add('hidden');
    document.getElementById('editContent').classList.remove('hidden');
    document.getElementById('editorToolbar').classList.remove('hidden');

    document.getElementById('editBtn').style.display = 'none';
    document.getElementById('viewBtn').style.display = 'inline-block';
    document.getElementById('saveBtn').style.display = 'inline-block';
    document.getElementById('cancelBtn').style.display = 'inline-block';
    document.getElementById('toggleMarkdownBtn').style.display = 'inline-block';

}

function saveArticle() {
    if (!currentArticlePath || !articles[currentArticlePath]) return;
    
    const newContent = document.getElementById('editContent').value;
    
    articles[currentArticlePath].content = newContent;
    articles[currentArticlePath].lastModified = new Date().toISOString();
    
    saveArticles();
    logChange('edit', currentArticlePath, articles[currentArticlePath].title);
    
    alert('Article saved successfully!');
    viewArticle();
}

function cancelEdit() {
    viewArticle();
    document.getElementById('articleMarkdownSource').classList.add('hidden');
}

function toggleSidebarEdit() {
    const editPanel = document.getElementById('sidebarEditPanel');
    const editBtn = document.getElementById('editSidebarBtn');
    
    if (!editPanel || !editBtn) {
        console.error('Sidebar edit elements not found');
        return;
    }
    
    const isHidden = editPanel.classList.contains('hidden');
    
    if (isHidden) {
        editPanel.classList.remove('hidden');
        editBtn.textContent = 'Cancel';
        renderSidebarFieldsEdit();
    } else {
        editPanel.classList.add('hidden');
        editBtn.textContent = 'Edit Sidebar';
    }
}

function renderSidebarFieldsEdit() {
    const fieldsEdit = document.getElementById('sidebarFieldsEdit');
    const article = articles[currentArticlePath];
    
    if (!fieldsEdit || !article) {
        console.error('sidebarFieldsEdit element or article not found');
        return;
    }
    
    fieldsEdit.innerHTML = '';
    
    if (article.sidebarFields && Array.isArray(article.sidebarFields) && article.sidebarFields.length > 0) {
        article.sidebarFields.forEach((field, index) => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'sidebar-field-edit';
            fieldDiv.innerHTML = `
                <input type="text" value="${field.label.replace(/"/g, '&quot;')}" class="sidebar-edit-input field-label" placeholder="Field name..." style="margin-top: 5px;">
                <input type="text" value="${field.value.replace(/"/g, '&quot;')}" class="sidebar-edit-input field-value" placeholder="Field value..." style="margin-top: 3px;">
                <button class="btn btn-danger" style="width: 100%; margin-top: 3px; font-size: 11px; padding: 3px;" type="button" onclick="removeSidebarField(${index})">Remove</button>
            `;
            fieldsEdit.appendChild(fieldDiv);
        });
    }
}

function addSidebarField() {
    const fieldsEdit = document.getElementById('sidebarFieldsEdit');
    if (!fieldsEdit) {
        console.error('sidebarFieldsEdit element not found');
        return;
    }
    
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'sidebar-field-edit';
    fieldDiv.innerHTML = `
        <input type="text" class="sidebar-edit-input field-label" placeholder="Field name (e.g., Population)..." style="margin-top: 5px;">
        <input type="text" class="sidebar-edit-input field-value" placeholder="Field value (e.g., 67 million)..." style="margin-top: 3px;">
        <button class="btn btn-danger" style="width: 100%; margin-top: 3px; font-size: 11px; padding: 3px;" type="button" onclick="removeSidebarField('new')">Remove</button>
    `;
    fieldsEdit.appendChild(fieldDiv);
}

function removeSidebarField(indexOrNew) {
    const fieldsEdit = document.getElementById('sidebarFieldsEdit');
    if (!fieldsEdit) return;
    
    if (indexOrNew === 'new') {
        // Remove the last (new) field
        const fields = fieldsEdit.querySelectorAll('.sidebar-field-edit');
        if (fields.length > 0) {
            fields[fields.length - 1].remove();
        }
    }
}

function saveSidebarEdit() {
    if (!currentArticlePath || !articles[currentArticlePath]) {
        alert('No article selected');
        return;
    }

    const sidebarImageUrl = document.getElementById('sidebarImageInput').value.trim();
    const fieldsEdit = document.getElementById('sidebarFieldsEdit');
    
    if (!fieldsEdit) {
        alert('Error: Sidebar edit panel not found');
        return;
    }
    
    const fieldInputs = fieldsEdit.querySelectorAll('.sidebar-field-edit');
    const sidebarFields = [];
    
    fieldInputs.forEach(fieldDiv => {
        const labelInput = fieldDiv.querySelector('.field-label');
        const valueInput = fieldDiv.querySelector('.field-value');
        if (labelInput && valueInput) {
            const label = labelInput.value.trim();
            const value = valueInput.value.trim();
            if (label && value) {
                sidebarFields.push({ label, value });
            }
        }
    });

    articles[currentArticlePath].sidebarImage = sidebarImageUrl;
    articles[currentArticlePath].sidebarFields = sidebarFields;
    articles[currentArticlePath].lastModified = new Date().toISOString();

    saveArticles();
    logChange('edit', currentArticlePath, `Edited sidebar: ${articles[currentArticlePath].title}`);
    alert('Sidebar saved!');
    
    // Close edit panel but keep article view open
    const editPanel = document.getElementById('sidebarEditPanel');
    const editBtn = document.getElementById('editSidebarBtn');
    if (editPanel && editBtn) {
        editPanel.classList.add('hidden');
        editBtn.textContent = 'Edit Sidebar';
    }

    // Refresh sidebar display without collapsing the panel
    const article = articles[currentArticlePath];
    const customFieldsContainer = document.getElementById('sidebarCustomFields');
    if (customFieldsContainer) {
        customFieldsContainer.innerHTML = '';
        if (article.sidebarFields && article.sidebarFields.length > 0) {
            article.sidebarFields.forEach(field => {
                const p = document.createElement('p');
                p.innerHTML = `<strong>${field.label}:</strong> ${field.value}`;
                customFieldsContainer.appendChild(p);
            });
        }
    }
    
    const sidebarImage = document.getElementById('sidebarImage');
    if (sidebarImage) {
        if (article.sidebarImage && article.sidebarImage.trim()) {
            sidebarImage.src = article.sidebarImage;
            sidebarImage.style.display = 'block';
        } else {
            sidebarImage.style.display = 'none';
        }
    }
}

function deleteArticle() {
    if (!currentArticlePath || !articles[currentArticlePath]) return;
    
    if (!confirm(`Are you sure you want to delete "${articles[currentArticlePath].title}"?`)) {
        return;
    }
    
    const title = articles[currentArticlePath].title;
    delete articles[currentArticlePath];
    saveArticles();
    logChange('delete', currentArticlePath, `Deleted: ${title}`);
    
    alert('Article deleted');
    showHome();
}

// ============ ARTICLES LIST ============
function listArticles() {
    console.log('>>> listArticles() called');
    updateURL('all-articles');
    hideAllViews();
    const articlesListViewEl = document.getElementById('articlesListView');
    if (articlesListViewEl) articlesListViewEl.classList.remove('hidden');
    safeSetText('articlesListTitle', 'All Articles');
    
    // Reload articles in case they were updated
    loadArticles();
    console.log('Loaded articles:', Object.keys(articles).length, 'articles');
    
    // Populate category filter
    console.log('>>> calling populateCategoryFilter()');
    populateCategoryFilter();
    console.log('>>> calling displayAllArticles()');
    displayAllArticles();
    console.log('>>> listArticles() complete');
}

function populateCategoryFilter() {
    // Ensure articles is populated from the canonical loader (articles.json + admin edits)
    loadArticles();
    
    // Get all unique categories
    const categories = new Set();
    Object.keys(articles).forEach(path => {
        const category = path.split('/')[0];
        categories.add(category);
    });
    
    // Populate the filter dropdown
    const filterSelect = document.getElementById('categoryFilter');
    if (!filterSelect) return;
    
    // Clear existing options (keep the first "All Categories" option)
    while (filterSelect.options.length > 1) {
        filterSelect.remove(1);
    }
    
    // Add categories
    Array.from(categories).sort().forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        filterSelect.appendChild(option);
    });
}

function displayAllArticles(filter = '', categoryFilter = '') {
    const list = document.getElementById('articlesList');
    if (!list) {
        console.error('articlesList element not found');
        return;
    }
    
    console.log('displayAllArticles called');
    
    // Make sure we have the latest articles from canonical loader
    loadArticles();
    
    const paths = Object.keys(articles);
    console.log('displayAllArticles: Found', paths.length, 'articles');
    console.log('Article paths:', paths);
    console.log('Articles object:', articles);
    
    let filteredPaths = paths.filter(path => {
        const article = articles[path];
        console.log('Checking path:', path, 'article:', article);
        if (!article) return false;
        
        // Check category filter
        if (categoryFilter) {
            const pathCategory = path.split('/')[0];
            if (pathCategory !== categoryFilter) return false;
        }
        
        // Check search filter
        if (filter) {
            return (article.title && article.title.toLowerCase().includes(filter.toLowerCase())) ||
                   (article.content && article.content.toLowerCase().includes(filter.toLowerCase()));
        }
        
        return true;
    });
    
    console.log('Filtered to:', filteredPaths.length, 'articles');
    
    if (filteredPaths.length === 0) {
        console.log('No articles after filter, showing message');
        list.innerHTML = '<p style="color: #a0b0d0; text-align: center; padding: 20px;">No articles found</p>';
        return;
    }
    
    console.log('Rendering articles...');
    const html = filteredPaths.map(path => {
        const article = articles[path];
        const category = path.split('/')[0];
        const charCount = (article.content || '').length;
        return `
            <div class="article-row" data-path="${path}" style="cursor: pointer; padding: 12px; background-color: #0f1b35; border: 1px solid #3a5a7a; border-radius: 4px; margin-bottom: 10px;">
                <div>
                    <div class="article-row-title" style="color: #5a9adf; font-weight: bold;">${article.title || 'Untitled'}</div>
                    <div class="article-row-meta" style="color: #7a8aaa; font-size: 12px;">${category} • ${formatDate(article.lastModified)}</div>
                </div>
                <div style="text-align: right;">
                    <div class="category-tag" style="display: inline-block; background-color: #1a3a5a; padding: 4px 8px; border-radius: 3px; font-size: 11px;">${category}</div>
                </div>
                <div style="text-align: right; color: #7a8aaa; font-size: 13px;">
                    <div>${charCount} chars</div>
                </div>
            </div>
        `;
    }).join('');
    
    console.log('Generated HTML length:', html.length);
    list.innerHTML = html;
    // Attach click handlers to rows (avoid inline onclick and ensure admin hash routing works)
    Array.from(list.querySelectorAll('.article-row')).forEach(row => {
        const p = row.dataset.path;
        if (!p) return;
        row.removeEventListener('click', row._gifskClickHandler);
        const handler = () => viewArticleByPath(p);
        row.addEventListener('click', handler);
        row._gifskClickHandler = handler;
    });
    console.log('Articles rendered to DOM');
}

function filterArticles() {
    const searchTerm = document.getElementById('articlesSearch').value;
    const categoryFilter = document.getElementById('categoryFilter') ? document.getElementById('categoryFilter').value : '';
    displayAllArticles(searchTerm, categoryFilter);
}

// ============ MEDIA MANAGEMENT ============
function showMedia() {
    alert('Media features are removed in this mode. Use article links or Argn link autocomplete.');
}

function displayMediaGallery() {
    // no-op: removed from UI
}

function displayArticleMedia(mediaIds) {
    const section = document.getElementById('articleMediaSection');
    const list = document.getElementById('articleMediaList');
    
    // Combine local media + argn media
    const allMedia = [...mediaLibrary, ...argMediaLibrary];
    
    if (!mediaIds || mediaIds.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    const items = mediaIds.map(id => allMedia.find(m => m.id === id)).filter(Boolean);
    
    if (items.length === 0) {
        section.style.display = 'none';
        return;
    }

    list.innerHTML = items.map((item, index) => `
        <div class="media-item" onclick="showMediaModal(${index})">
            ${getMediaPreview(item)}
            <div class="media-info">
                <div class="media-title">${item.title}</div>
                <div class="media-type">${item.type}</div>
            </div>
        </div>
    `).join('');
}

function toggleMarkdownSource() {
    const mdPane = document.getElementById('articleMarkdownSource');
    const btn = document.getElementById('toggleMarkdownBtn');
    if (mdPane.classList.contains('hidden')) {
        mdPane.classList.remove('hidden');
        btn.textContent = 'Hide Markdown';
    } else {
        mdPane.classList.add('hidden');
        btn.textContent = 'Show Markdown';
    }
}

function applyMarkdownFormat(type, targetId = null) {
    const id = targetId || (isEditing ? 'editContent' : 'newContent');
    const textarea = document.getElementById(id);
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || '';
    let markdown = '';
    let selection = selected;

    switch (type) {
        case 'bold':
            markdown = `**${selected || 'bold text'}**`;
            break;
        case 'italic':
            markdown = `*${selected || 'italic text'}*`;
            break;
        case 'heading':
            markdown = `${selected ? '# ' + selected : '## Heading'} `;
            break;
        case 'link': {
            const urlInput = prompt('Enter URL or argn slug (e.g. argn:my-topic):', 'https://');
            if (!urlInput) return;
            let url = urlInput;
            if (urlInput.toLowerCase().startsWith('argn:')) {
                const slug = urlInput.split(':')[1].trim();
                if (!slug) return;
                url = `https://argn.quest/wiki/${encodeURI(slug.replace(/\s+/g, '-').toLowerCase())}`;
            }
            markdown = `[${selected || 'link text'}](${url})`;
            break;
        }
        case 'image': {
            const imageUrl = prompt('Enter image URL:', 'https://');
            if (!imageUrl) return;
            markdown = `![${selected || 'alt text'}](${imageUrl})`;
            break;
        }
        case 'code':
            if (selected) {
                markdown = `\n\n\`\`\`\n${selected}\n\`\`\`\n\n`;
            } else {
                markdown = '\n\n```\ncode here\n```\n\n';
            }
            break;
        case 'quote':
            if (selected) {
                markdown = selected.split('\n').map(line => `> ${line}`).join('\n');
            } else {
                markdown = '> Blockquote';
            }
            break;
        case 'list':
            if (selected) {
                markdown = selected.split('\n').map(line => `- ${line}`).join('\n');
            } else {
                markdown = '- List item';
            }
            break;
        default:
            return;
    }

    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + markdown + after;
    const cursorEnd = before.length + markdown.length;

    textarea.focus();
    textarea.selectionStart = cursorEnd;
    textarea.selectionEnd = cursorEnd;

    if (id === 'editContent') {
        safeSetText('articleMarkdownSource', textarea.value);
    }
}

function getMediaPreview(item) {
    if (item.type === 'image') {
        return `<img src="${item.link}" alt="${item.title}">`;
    } else if (item.type === 'video') {
        const isYoutube = item.link.includes('youtube.com') || item.link.includes('youtu.be');
        if (isYoutube) {
            const videoId = extractYoutubeId(item.link);
            return `<img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="${item.title}"><div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 40px; color: #fff;">▶</div>`;
        } else {
            return `<video style="width: 100%; height: 150px; object-fit: cover;"><source src="${item.link}"></video>`;
        }
    } else if (item.type === 'audio') {
        return `<div style="width: 100%; height: 150px; display: flex; align-items: center; justify-content: center; background-color: #1a2a4a; font-size: 32px;">🎵</div>`;
    }
}

function extractYoutubeId(url) {
    const patterns = [
        /[?&]v=([^&#]+)/,
        /youtu\.be\/([^?&#]+)/,
        /youtube\.com\/shorts\/([^?&#]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m && m[1]) return m[1];
    }
    return '';
}

function showMediaModal(index) {
    const allMedia = [...mediaLibrary, ...argMediaLibrary];
    const item = allMedia[index];
    
    if (!item) return;
    
    const container = document.getElementById('modalMediaContainer');
    
    let content = '';
    if (item.type === 'image') {
        content = `<img src="${item.link}" alt="${item.title}">`;
    } else if (item.type === 'video') {
        if (item.link.includes('youtube') || item.link.includes('youtu.be')) {
            const videoId = extractYoutubeId(item.link);
            content = `<iframe width="100%" height="500" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
        } else {
            content = `<video width="100%" height="auto" controls><source src="${item.link}"></video>`;
        }
    } else if (item.type === 'audio') {
        content = `<audio width="100%" controls><source src="${item.link}"></audio>`;
    }
    
    container.innerHTML = `
        <div style="text-align: center;">
            ${content}
            <h2 style="color: #fff; margin-top: 20px;">${item.title}</h2>
            <p style="color: #a0b0d0; margin-top: 10px;">${item.description || ''}</p>
            <p style="color: #7a8aaa; font-size: 13px; margin-top: 15px;">
                Type: ${item.type} | Credits: ${item.credits || 'Unknown'}
            </p>
            ${item.tags ? `<p style="color: #5a9adf; font-size: 12px;">${item.tags.join(', ')}</p>` : ''}
        </div>
    `;
    
    document.getElementById('mediaModal').classList.remove('hidden');
}

function closeMediaModal() {
    document.getElementById('mediaModal').classList.add('hidden');
}

// ============ MEDIA UPLOAD & IMPORT ============
function showUploadMedia() {
    alert('Upload media has been removed in this edition. Use article content / argn link search.');
}

function uploadMedia() {
    alert('Upload media has been removed.');
}

function cancelUpload() {
    showHome();
}

async function loadArgnIndex() {
    try {
        const apiUrl = 'https://api.github.com/repos/rainbow211793/argn/contents';
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to load argn index');

        const data = await response.json();
        const rootTitles = data
            .filter(item => item.name.endsWith('.md'))
            .map(item => item.name.replace(/\.md$/i, '').replace(/-/g, ' '));

        let docTitles = [];
        const docsFolder = data.find(item => item.name === 'docs' && item.type === 'dir');
        if (docsFolder) {
            const docsResponse = await fetch(docsFolder.url);
            if (docsResponse.ok) {
                const docsData = await docsResponse.json();
                docTitles = docsData
                    .filter(item => item.name.endsWith('.md'))
                    .map(item => item.name.replace(/\.md$/i, '').replace(/-/g, ' '));
            }
        }

        argnArticleTitles = [...new Set([...rootTitles, ...docTitles])];
        console.log('Argn lookup loaded', argnArticleTitles.length, 'titles');
    } catch (error) {
        console.warn('Could not load Argn title index:', error.message);
        argnArticleTitles = [];
    }
}

function toggleArgnAutocomplete() {
    const panel = document.getElementById('argnAutocomplete');
    const visible = !panel.classList.contains('hidden');
    if (visible) {
        panel.classList.add('hidden');
    } else {
        panel.classList.remove('hidden');
        const input = document.getElementById('argnSearchInput');
        input.value = '';
        updateArgnSuggestions('');
        input.focus();
    }
}

function updateArgnSuggestions(query) {
    const list = document.getElementById('argnSuggestionList');
    if (!list) return;

    const lower = query.trim().toLowerCase();
    
    // Local articles
    const localResults = Object.values(articles)
        .filter(article => article.title.toLowerCase().includes(lower))
        .map(article => ({
            title: article.title,
            source: 'local',
            slug: article.slug
        }));

    // Argn articles
    const argnResults = argnArticleTitles
        .filter(title => title.toLowerCase().includes(lower))
        .map(title => ({
            title,
            source: 'argn',
            slug: title.trim().toLowerCase().replace(/\s+/g, '-')
        }));

    const combined = [...localResults, ...argnResults].slice(0, 10);

    if (combined.length === 0) {
        list.innerHTML = '<li style="color: #7a8aaa;">No matches found</li>';
        return;
    }

    list.innerHTML = combined.map(item => `
        <li style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px;">
            <div style="flex:1; cursor:pointer;" onclick="insertSuggestion('${encodeURIComponent(item.title)}', '${item.source}')">${item.title}</div>
            <div style="display:flex; gap:8px; align-items:center;">
                <span style="font-size: 11px; color: #5a7aaa;">${item.source === 'local' ? '📖' : '🔗'}</span>
                <button type="button" onclick="${item.source === 'local' ? `quoteLocalByTitle('${encodeURIComponent(item.title)}')` : `quoteArgnSuggestion('${encodeURIComponent(item.title)}','${item.slug || ''}')`}" style="font-size:11px; padding:2px 6px;">Quote</button>
            </div>
        </li>
    `).join('');
}

function insertSuggestion(encodedTitle, source) {
    const title = decodeURIComponent(encodedTitle);
    let url;

    if (source === 'local') {
        // Find the article by title and get its path
        const article = Object.values(articles).find(a => a.title === title);
        const path = article?.path || `gifsk/${generateSlug(title)}`;
        url = `#article:${encodeURIComponent(path)}`;
    } else {
        const slug = title.trim().toLowerCase().replace(/\s+/g, '-');
        url = `https://argn.quest/wiki/${encodeURI(slug)}`;
    }

    const textarea = document.getElementById('editContent');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || title;
    const markdown = `[${selected}](${url})`;

    textarea.value = textarea.value.slice(0, start) + markdown + textarea.value.slice(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + markdown.length;

    document.getElementById('argnAutocomplete').classList.add('hidden');
}

async function loadArgMedia() {
    try {
        const url = 'https://raw.githubusercontent.com/rainbow211793/argn/main/media.json';
        const response = await fetch(url);
        const data = await response.json();

        if (data.media) {
            argMediaLibrary = data.media.map(item => ({
                ...item,
                id: item.id || `arg_${item.slug || Date.now()}`
            }));
        }
    } catch (error) {
        console.log('Could not load Argn media automatically');
    }
}

async function importArgMedia() {
    const url = document.getElementById('argMediaUrl').value;
    
    if (!url) {
        alert('Please enter a media.json URL');
        return;
    }
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.media) {
            argMediaLibrary = data.media.map(item => ({
                ...item,
                id: item.id || `arg_${item.slug || Date.now()}`
            }));
            alert(`Successfully imported ${data.media.length} media items from Argn!`);
            showMedia();
        } else {
            alert('Invalid media.json format');
        }
    } catch (error) {
        alert('Failed to fetch media. Check the URL and try again.');
    }
}

function showImported() {
    alert('Imported media view is disabled. Use Argn article linking via Autocomplete.');
}

// ============ CATEGORIES ============
function showCategories() {
    updateURL('categories');
    // Reload articles in case they were updated
    loadArticles();
    hideAllViews();
    document.getElementById('categoriesView').classList.remove('hidden');
    
    const categories = getTopLevelCategories();
    const categoryCount = {};
    
    Object.keys(articles).forEach(path => {
        const cat = path.split('/')[0];
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });
    
    const list = document.getElementById('categoriesList');
    
    if (categories.length === 0) {
        list.innerHTML = '<p style="color: #a0b0d0; text-align: center; padding: 40px;">No articles yet</p>';
        return;
    }
    // Get category settings (custom names/emojis) from localStorage if available
    const categorySettings = JSON.parse(localStorage.getItem('gifskCategorySettings')) || {
        'gifstad': { name: 'Gifstad', emoji: '🏰' },
        'gifsk': { name: 'Gifsk', emoji: '🎨' },
        'history': { name: 'History', emoji: '📚' },
        'science': { name: 'Science', emoji: '🔬' },
        'general': { name: 'General', emoji: '📄' }
    };

    list.innerHTML = categories
        .sort()
        .map(name => {
            const setting = categorySettings[name] || { name: name, emoji: '📑' };
            return `
            <div class="category-card" onclick="showCategoryArticles('${name}')">
                <div class="category-card-icon">${setting.emoji}</div>
                <div class="category-card-name">${setting.name}</div>
                <div class="category-card-count">${categoryCount[name]} article${categoryCount[name] !== 1 ? 's' : ''}</div>
            </div>
        `;
        })
        .join('');
}

// ============ RECENT CHANGES ============
function showRecent() {
    const container = document.getElementById('viewContainer');
    if (!container) {
        // If viewContainer missing (unlikely), open admin recent changes
        window.open('admin.html#recent', '_blank');
        return;
    }
    updateURL('recent');
    hideAllViews();
    container.classList.remove('hidden');

    // Reload recent changes from localStorage
    recentChanges = JSON.parse(localStorage.getItem('gifskRecentChanges')) || [];

    container.innerHTML = `
        <h1 style="color: #fff; border-bottom: 2px solid #3a5a7a; padding-bottom: 15px;">Recent Changes</h1>
        <div style="display: grid; gap: 10px;">
            ${recentChanges.length === 0 ? '<p style="color: #a0b0d0;">No changes yet</p>' : recentChanges.slice().reverse().map(change => `
                <div style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 4px; padding: 15px; cursor: pointer;" onclick="${change.path ? `viewArticleByPath('${change.path}')` : ''}" style="cursor: ${change.path ? 'pointer' : 'default'};">
                    <p style="color: #fff; margin: 0;"><strong>${change.type.toUpperCase()}</strong> — ${change.message}</p>
                    <p style="color: #7a8aaa; font-size: 13px; margin: 5px 0 0 0;">${formatDate(change.timestamp)}</p>
                </div>
            `).join('')}
        </div>
    `;
}

// ============ SEARCH ============
function performSearch(query) {
    if (!query.trim()) {
        showHome();
        return;
    }
    
    hideAllViews();
    const container = document.getElementById('viewContainer');
    container.classList.remove('hidden');
    
    const results = [];
    
    // Search articles
    Object.entries(articles).forEach(([path, article]) => {
        if (article.title.toLowerCase().includes(query.toLowerCase()) ||
            (article.content || '').toLowerCase().includes(query.toLowerCase())) {
            results.push({
                type: 'article',
                title: article.title,
                path,
                preview: truncate(article.content, 100)
            });
        }
    });
    
    container.innerHTML = `
        <h1 style="color: #fff; border-bottom: 2px solid #3a5a7a; padding-bottom: 15px;">Search Results for "${query}"</h1>
        <p style="color: #a0b0d0; margin-bottom: 20px;">Found ${results.length} result${results.length !== 1 ? 's' : ''}</p>
        <div style="display: grid; gap: 15px;">
            ${results.length === 0 ? '<p style="color: #a0b0d0;">No results found. Try creating an article about this topic!</p>' : results.map(result => `
                <div onclick="viewArticleByPath('${result.path}')" style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 6px; padding: 15px; cursor: pointer; transition: all 0.3s;" onmouseover="this.style.borderColor='#5a7aaa'" onmouseout="this.style.borderColor='#3a5a7a'">
                    <h3 style="color: #5a9adf; margin: 0 0 8px 0;">${result.title}</h3>
                    <p style="color: #a0b0d0; font-size: 14px; margin: 0;">${result.preview}</p>
                </div>
            `).join('')}
        </div>
    `;
}

// ============ UTILITY FUNCTIONS ============
function slugify(str) {
    return str.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-');
}

function generateSlug(str) {
    return slugify(str);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

// ----------------- Quoting helpers -----------------
function getExcerptFromContent(content, maxLen = 240) {
    if (!content) return '';
    // Remove code blocks and simple markdown tokens for a cleaner excerpt
    let plain = content.replace(/```[\s\S]*?```/g, '')
                       .replace(/`[^`]*`/g, '')
                       .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
                       .replace(/[#>*_~]/g, '')
                       .trim();
    // Use first paragraph if available
    const parts = plain.split(/\n\s*\n/);
    const first = (parts[0] || plain).replace(/\s+/g, ' ').trim();
    return truncate(first, maxLen);
}

function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
    } catch (e) {}
    // Fallback
    try {
        prompt('Copy the following text:', text);
        return Promise.resolve();
    } catch (e) {
        return Promise.reject(new Error('Copy failed'));
    }
}

function buildQuoteMarkdown(excerpt, title, url, sourceLabel) {
    const q = excerpt.replace(/\n/g, '\n> ');
    const label = sourceLabel ? ` (${sourceLabel})` : '';
    return `> ${q}\n\n— [${title}](${url})${label}`;
}

function insertQuoteIntoEditor(markdown) {
    const textarea = document.getElementById('editContent') || document.getElementById('newContent');
    if (!textarea) return false;
    const start = textarea.selectionStart || textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(start);
    textarea.value = before + markdown + '\n\n' + after;
    textarea.focus();
    const pos = before.length + markdown.length + 2;
    textarea.selectionStart = textarea.selectionEnd = pos;
    // update markdown preview/source if present
    const mdSource = document.getElementById('articleMarkdownSource');
    if (mdSource) safeSetText('articleMarkdownSource', textarea.value);
    return true;
}

function quoteArticle(path) {
    if (!path) return;
    const article = articles[path];
    const title = article ? (article.title || path) : path;
    const excerpt = article ? getExcerptFromContent(article.content || '') : title;
    const origin = window.location.origin.replace(/:\d+$/, '');
    const url = article ? (origin + '/#' + path) : (origin + '/#' + path);
    const md = buildQuoteMarkdown(excerpt, title, url, 'Gifsk Wiki');
    copyToClipboard(md).then(() => {
        alert('Quote copied to clipboard!');
    }).catch(() => {
        prompt('Quote (copy manually):', md);
    });
    // If editor is open, insert quote there as well
    insertQuoteIntoEditor(md);
}

function quoteArgnSuggestion(encodedTitle, slug) {
    const title = decodeURIComponent(encodedTitle);
    const slugSafe = slug || title.trim().toLowerCase().replace(/\s+/g, '-');
    const url = `https://argn.quest/wiki/${encodeURI(slugSafe)}`;
    const excerpt = title; // no remote content available, use title
    const md = buildQuoteMarkdown(excerpt, title, url, 'Argn');
    copyToClipboard(md).then(() => {
        alert('Argn quote copied to clipboard!');
    }).catch(() => {
        prompt('Quote (copy manually):', md);
    });
    insertQuoteIntoEditor(md);
}

function quoteLocalByTitle(encodedTitle) {
    const title = decodeURIComponent(encodedTitle);
    const article = Object.values(articles).find(a => a.title === title);
    if (article && article.path) {
        quoteArticle(article.path);
    } else {
        alert('Local article not found for quoting');
    }
}

function addRecentChange(text) {
    recentChanges.unshift({
        text,
        timestamp: new Date().toISOString()
    });
    if (recentChanges.length > 50) recentChanges.pop();
    localStorage.setItem('gifskRecentChanges', JSON.stringify(recentChanges));
}

function saveArticles() {
    if (!IS_ADMIN_PAGE) return; // Public site is read-only
    localStorage.setItem('gifskArticles', JSON.stringify(articles));
}

function logChange(type, path, message) {
    if (!IS_ADMIN_PAGE) return; // Public site is read-only
    const change = {
        timestamp: new Date().toISOString(),
        type,
        path,
        message,
        editor: 'user'
    };
    recentChanges.push(change);
    localStorage.setItem('gifskRecentChanges', JSON.stringify(recentChanges));
}

// Path-based organization - no folder tables, just hierarchical article paths
function getTopLevelCategories() {
    loadArticles(); // Ensure articles are loaded before extracting categories
    const categories = new Set();
    Object.keys(articles).forEach(path => {
        const parts = path.split('/');
        if (parts.length > 0) {
            categories.add(parts[0]);
        }
    });
    return Array.from(categories).sort();
}

function getArticlesInCategory(category) {
    return Object.entries(articles)
        .filter(([path]) => path.startsWith(category + '/'))
        .map(([path, article]) => article);
}

function showCategoryArticles(category) {
    updateURL(`${category}/all`);
    hideAllViews();
    const articlesListViewEl = document.getElementById('articlesListView');
    if (articlesListViewEl) articlesListViewEl.classList.remove('hidden');
    safeSetText('articlesListTitle', `Category: ${category}`);
    
    // Set the category filter without triggering re-filter
    const categorySelect = document.getElementById('categoryFilter');
    if (categorySelect) {
        categorySelect.value = category;
    }
    
    displayAllArticles('', category);
}

function cancelCreate() {
    const newTitleEl = document.getElementById('newTitle'); if (newTitleEl) newTitleEl.value = '';
    const newCategoryEl = document.getElementById('newCategory'); if (newCategoryEl) newCategoryEl.value = '';
    const newContentEl = document.getElementById('newContent'); if (newContentEl) newContentEl.value = '';
    showHome();
}

function hideAllViews() {
    const ids = ['viewContainer', 'articleView', 'mediaView', 'articlesListView', 'categoriesView', 'createView', 'uploadView', 'jsonEditorView', 'manageCategoriesView'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}
