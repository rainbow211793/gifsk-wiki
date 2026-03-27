// Admin-only functions for JSON editing

// Default categories
const DEFAULT_CATEGORIES = {
    'gifstad': { name: 'Gifstad', emoji: '🏰' },
    'gifsk': { name: 'Gifsk', emoji: '🎨' },
    'history': { name: 'History', emoji: '📚' },
    'science': { name: 'Science', emoji: '🔬' },
    'general': { name: 'General', emoji: '📄' }
};

// Category customization storage
let categorySettings = JSON.parse(localStorage.getItem('gifskCategorySettings')) || DEFAULT_CATEGORIES;
// Temp session copies used while Manage Categories view is open
let tempCategorySettings = null;
let tempDeletedCategories = null;

function saveCategorySettings() {
    localStorage.setItem('gifskCategorySettings', JSON.stringify(categorySettings));
}

function showManageCategories() {
    if (!IS_ADMIN_PAGE) {
        alert('Not authorized');
        return;
    }
    
    hideAllViews();
    const view = document.getElementById('manageCategoriesView');
    if (!view) return;
    view.classList.remove('hidden');
    
    // Prepare temp session state so changes can be cancelled
    tempCategorySettings = Object.assign({}, categorySettings);
    tempDeletedCategories = new Set();

    // Get categories from both articles AND temp category settings (but don't mutate persistent settings)
    loadArticles();
    const articleCategories = getTopLevelCategories();
    const allCategories = new Set([...articleCategories, ...Object.keys(tempCategorySettings)]);
    // Remove any categories marked deleted in this session
    tempDeletedCategories.forEach(d => allCategories.delete(d));
    const categories = Array.from(allCategories).sort();
    
    const list = document.getElementById('categoriesManagerList');
    if (!list) return;
    
    let htmlContent = '';
    
    // Show existing categories
    if (categories.length > 0) {
        htmlContent += categories.map(cat => {
            const setting = tempCategorySettings[cat] || DEFAULT_CATEGORIES[cat] || { name: cat, emoji: '📑' };
            const sanitizedCat = cat.replace(/[^a-zA-Z0-9-]/g, '_'); // Safe ID version
            return `
            <div id="category-${sanitizedCat}" style="background-color: #1a2a4a; border: 1px solid #3a5a7a; border-radius: 4px; padding: 15px;">
                <div style="display: grid; grid-template-columns: 1fr 2fr 2fr 100px; gap: 10px; align-items: center;">
                    <div><strong style="color: #fff;">${cat}</strong></div>
                    <div><input type="text" id="cat-emoji-${sanitizedCat}" value="${setting.emoji}" placeholder="📑" maxlength="2" style="width: 100%; padding: 8px; background-color: #0d1731; border: 1px solid #3a5a7a; color: #fff; border-radius: 4px;" /></div>
                    <div><input type="text" id="cat-name-${sanitizedCat}" value="${setting.name}" placeholder="Category name" style="width: 100%; padding: 8px; background-color: #0d1731; border: 1px solid #3a5a7a; color: #fff; border-radius: 4px;" /></div>
                    <button class="btn btn-danger" onclick="deleteCategoryTemp('${sanitizedCat}', '${cat}')" style="width: 100%;">Delete</button>
                </div>
            </div>`;
        }).join('');
    }
    
    // Add new category form
    htmlContent += `
        <div style="background-color: #0f1b35; border: 2px dashed #3a5a7a; border-radius: 4px; padding: 15px; margin-top: 20px;">
            <h3 style="color: #fff; margin-top: 0;">Add New Category</h3>
            <div style="display: grid; grid-template-columns: 1fr 2fr 2fr 100px; gap: 10px; align-items: center;">
                <input type="text" id="new-cat-key" placeholder="category-key" style="padding: 8px; background-color: #0d1731; border: 1px solid #3a5a7a; color: #fff; border-radius: 4px;" />
                <input type="text" id="new-cat-emoji" placeholder="📑" maxlength="2" style="padding: 8px; background-color: #0d1731; border: 1px solid #3a5a7a; color: #fff; border-radius: 4px;" />
                <input type="text" id="new-cat-name" placeholder="Display Name" style="padding: 8px; background-color: #0d1731; border: 1px solid #3a5a7a; color: #fff; border-radius: 4px;" />
                <button class="btn btn-success" onclick="addNewCategory()" style="width: 100%;">Add</button>
            </div>
        </div>
        <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button class="btn btn-success" onclick="saveCategorySettingsAndReload()">Save All</button>
            <button class="btn btn-secondary" onclick="showHome()">Cancel</button>
        </div>
    `;
    
    list.innerHTML = htmlContent;
}

function addNewCategory() {
    const key = document.getElementById('new-cat-key').value.trim().toLowerCase();
    const emoji = document.getElementById('new-cat-emoji').value.trim() || '📑';
    const name = document.getElementById('new-cat-name').value.trim() || key;
    
    if (!key) {
        alert('Please enter a category key');
        return;
    }
    
    if (!tempCategorySettings) tempCategorySettings = Object.assign({}, categorySettings);
    if (tempCategorySettings[key]) {
        alert('Category already exists');
        return;
    }

    tempCategorySettings[key] = { name, emoji };
    // Re-open manage view to refresh list and show the new entry (session-only for now)
    showManageCategories();
}

function deleteCategoryTemp(sanitizedId, originalCat) {
    if (!confirm(`Delete category "${originalCat}"? This will remove custom name/emoji for this category in this session. Save to persist.`)) {
        return;
    }

    // Lazily prepare temp session store
    if (!tempCategorySettings) tempCategorySettings = Object.assign({}, categorySettings);
    if (!tempDeletedCategories) tempDeletedCategories = new Set();

    // Ask whether to remove the category from existing articles (make them categoryless)
    const removeFromArticles = confirm(`Also remove the category "${originalCat}" from all articles?\n\nOK = remove category from articles (paths will be adjusted), Cancel = leave articles unchanged.`);

    // Mark deleted in this session
    tempDeletedCategories.add(originalCat);
    // Also remove any temp setting so it won't be re-saved
    if (tempCategorySettings[originalCat]) delete tempCategorySettings[originalCat];

    // If requested, delete all articles in this category from admin localStorage and in-memory
    if (removeFromArticles && IS_ADMIN_PAGE) {
        try {
            loadArticles();
            const stored = JSON.parse(localStorage.getItem('gifskArticles')) || {};
            const toDelete = Object.keys(articles).filter(key => key === originalCat || key.indexOf(originalCat + '/') === 0);

            if (toDelete.length === 0) {
                alert('No articles found for this category.');
            } else {
                toDelete.forEach(k => {
                    delete articles[k];
                    if (stored[k]) delete stored[k];
                });
                localStorage.setItem('gifskArticles', JSON.stringify(stored));
                // reload in-memory articles
                loadArticles();
                alert(`Deleted ${toDelete.length} article(s) in category "${originalCat}".`);
            }
        } catch (e) {
            console.error('Failed to delete articles when removing category:', e);
            alert('Failed to delete articles: ' + e.message);
        }
    }

    // Remove from DOM immediately for feedback
    const el = document.getElementById(`category-${sanitizedId}`);
    if (el) el.remove();
}

function saveCategorySettingsAndReload() {
    loadArticles();
    const articleCategories = getTopLevelCategories();
    // Build final settings from temp session state. If user didn't open manage view, fall back to current settings.
    const working = tempCategorySettings ? Object.assign({}, tempCategorySettings) : Object.assign({}, categorySettings);

    // Apply any edits entered in the DOM for visible categories
    const allCategories = new Set([...articleCategories, ...Object.keys(working)]);
    // Exclude any that were deleted in session
    if (tempDeletedCategories) tempDeletedCategories.forEach(d => allCategories.delete(d));

    allCategories.forEach(cat => {
        const sanitizedCat = cat.replace(/[^a-zA-Z0-9-]/g, '_');
        const emojiEl = document.getElementById(`cat-emoji-${sanitizedCat}`);
        const nameEl = document.getElementById(`cat-name-${sanitizedCat}`);

        if (emojiEl && nameEl) {
            working[cat] = {
                emoji: emojiEl.value || '📑',
                name: nameEl.value || cat
            };
        }
    });

    // Persist: replace categorySettings with working, removing any session-deleted keys
    categorySettings = working;
    if (tempDeletedCategories) tempDeletedCategories.forEach(d => { if (categorySettings[d]) delete categorySettings[d]; });
    saveCategorySettings();

    // After saving category settings, update articles in admin localStorage to include display metadata
    try {
        loadArticles();
        const stored = JSON.parse(localStorage.getItem('gifskArticles')) || {};
        Object.keys(articles).forEach(path => {
            const cat = path.split('/')[0];
            if (categorySettings[cat]) {
                const s = categorySettings[cat];
                articles[path].categoryDisplay = s.name;
                articles[path].categoryEmoji = s.emoji;
                stored[path] = articles[path];
            } else {
                if (articles[path].categoryDisplay) delete articles[path].categoryDisplay;
                if (articles[path].categoryEmoji) delete articles[path].categoryEmoji;
                if (stored[path]) stored[path] = articles[path];
            }
        });
        localStorage.setItem('gifskArticles', JSON.stringify(stored));
    } catch (e) {
        console.warn('Failed to persist category display into stored articles', e);
    }

    // Clear temp session state
    tempCategorySettings = null;
    tempDeletedCategories = null;

    alert('Category settings saved!');
    showHome();
}

function showJSONEditor() {
    hideAllViews();
    document.getElementById('jsonEditorView').classList.remove('hidden');
    
    // Show ENTIRE articles JSON so users can copy/paste wholesale
    document.getElementById('jsonEditor').value = JSON.stringify(articles, null, 2);
}

function downloadJSON() {
    const jsonData = {
        articles: articles,
        mediaLibrary: mediaLibrary,
        argMediaLibrary: argMediaLibrary,
        recentChanges: recentChanges,
        timestamp: new Date().toISOString(),
        version: '1.0'
    };
    
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gifsk-wiki-full-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function applyJSON() {
    const editorContent = document.getElementById('jsonEditor').value;
    
    try {
        const jsonData = JSON.parse(editorContent);
        
        // Handle both formats: raw articles object or full json with articles property
        if (jsonData.articles && typeof jsonData.articles === 'object' && !Array.isArray(jsonData.articles)) {
            // Format: { articles: {...}, mediaLibrary: [...], etc }
            articles = jsonData.articles || {};
            mediaLibrary = jsonData.mediaLibrary || [];
            argMediaLibrary = jsonData.argMediaLibrary || [];
            recentChanges = jsonData.recentChanges || [];
        } else if (typeof jsonData === 'object' && !Array.isArray(jsonData)) {
            // Format: raw articles object { "category/slug": {...}, ... }
            articles = jsonData;
        } else {
            throw new Error('Invalid JSON: expected articles object');
        }
        
        // Save to localStorage
        localStorage.setItem('gifskArticles', JSON.stringify(articles));
        localStorage.setItem('gifskMedia', JSON.stringify(mediaLibrary));
        localStorage.setItem('gifskRecentChanges', JSON.stringify(recentChanges));
        
        alert('Articles updated successfully! Refreshing...');
        location.reload();
    } catch (error) {
        alert('Error parsing JSON: ' + error.message);
    }
}
