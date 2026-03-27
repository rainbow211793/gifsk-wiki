# Gifsk Wiki - Free Encyclopedia Platform

A Wikipedia-style editable encyclopedia built with the Argn framework color scheme. Create, edit, and share articles with built-in media support compatible with Argn's media library.

## Features

✨ **Core Features**
- 📝 Create and edit articles with Markdown support
- 📸 Media gallery with image, video, and audio support
- 🏷️ Categorize articles for easy browsing
- 🔍 Full-text search across all articles
- 📊 Recent changes tracking
- 💾 LocalStorage-based persistence (no server needed)

🎨 **Design**
- Wikipedia-style layout and formatting
- Argn color scheme (dark blue/teal theme)
- Fully responsive design
- Smooth transitions and interactions

🔗 **Media Support**
- Direct URL uploading for images, videos, and audio
- **Cross-compatible with Argn media.json** - import media directly from Argn!
- Embed media in articles
- Media gallery with metadata

## Installation & Setup

### Option 1: GitHub Pages (Recommended)

1. Fork this repository
2. Enable GitHub Pages in repository settings (Settings → Pages)
3. Point to the `main` branch (or whichever branch you want to serve)
4. Your wiki will be available at `https://yourusername.github.io/gifsk.wiki`

### Option 2: Local Use

1. Clone the repository
2. Open `index.html` in a web browser
3. Start creating articles!

### Option 3: Host on Any Web Server

Upload the files to any web server that serves static files (Apache, Nginx, etc.)

## How to Use

### Creating an Article
1. Click "Create Article" in the sidebar
2. Enter a title, category (optional), and content
3. Use Markdown for formatting
4. Click "Create Article"

### Editing Articles
1. Find and open any article
2. Click "Edit" button
3. Make your changes
4. Click "Save"

### Adding Media
1. Click "Upload Media" in the sidebar
2. Enter a URL to an image, video, or audio file
3. Add title, description, and tags
4. Click "Upload"

### Importing from Argn
1. Click "Upload Media" → "Import from Argn"
2. The tool will automatically load Argn's media.json
3. Or paste a custom media.json URL
4. Click "Import from Argn"

### Using [[wikilinks]]
In articles, use `[[Article Name]]` format to create internal links (this will be enhanced in future versions).

## Data Structure

### articles.json Structure
```json
{
  "slug": {
    "title": "Article Title",
    "category": "Category Name",
    "content": "Markdown content...",
    "slug": "article-title",
    "createdAt": "ISO date string",
    "lastEditedAt": "ISO date string",
    "lastEditedBy": "Username",
    "mediaIds": ["media_id_1", "media_id_2"]
  }
}
```

### media.json Structure (Compatible with Argn)
```json
{
  "id": "unique_id",
  "type": "image|video|audio",
  "title": "Media Title",
  "link": "https://example.com/file.ext",
  "description": "Description",
  "tags": ["tag1", "tag2"],
  "credits": "Creator Name",
  "submitted_by": "Username"
}
```

## Storage

- **Articles**: Stored in browser LocalStorage (`gifskArticles`)
- **User-uploaded Media**: Stored in browser LocalStorage (`gifskMedia`)
- **Imported Media**: Cached in memory (`gifskArgMedia`)
- **Recent Changes**: Stored in browser LocalStorage (`gifskRecentChanges`)

### Backing Up Your Data

To export your articles and media:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Run: `copy(JSON.stringify({articles: localStorage.gifskArticles, media: localStorage.gifskMedia}, null, 2))`
4. Paste into a text file and save

## Markdown Support

All article content supports standard Markdown:

```markdown
# Heading 1
## Heading 2
### Heading 3

**Bold text**
*Italic text*
~~Strikethrough~~

- Bullet point
- Another point

1. Numbered list
2. Another item

[Link text](https://example.com)

![Image alt](image-url)

> Blockquote

\`\`\`
Code block
\`\`\`
```

## Compatibility with Argn

Gifsk Wiki is fully compatible with Argn's media library:

- **Import Argn Media**: Access Argn's media.json directly
- **Cross-reference**: Link to both Argn and Gifsk Wiki articles
- **Shared Media**: Use the same media URLs from Argn
- **Same Color Scheme**: Visual consistency between platforms

To import Argn media:
1. Go to Upload Media section
2. Click "Import from Argn"
3. Use the default URL or enter a custom media.json URL
4. Browse and use media in your articles

## Customization

### Change Colors
Edit `style.css` to modify the color scheme:
- `#1a2a4a` - Main background (dark blue)
- `#0f1b35` - Secondary background (darker blue)
- `#3a5a7a` - Borders/accents (medium blue)
- `#5a7aaa` - Hover states (lighter blue)
- `#e0e0e0` - Main text color
- `#a0b0d0` - Secondary text

### Add More Categories
Categories are dynamically generated from articles, just set the category field when creating articles.

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- IE11: ❌ Not supported (uses modern JavaScript)

## Future Enhancements

- [ ] Server-based storage option
- [ ] User authentication and permissions
- [ ] Revision history
- [ ] Advanced search with filters
- [ ] Table of contents generation
- [ ] Citations and references
- [ ] Collaborative editing
- [ ] Image gallery with lightbox
- [ ] Syntax highlighting for code blocks
- [ ] LaTeX math equation support

## Credits

- Built as a companion to [Argn](https://github.com/rainbow211793/argn)
- Uses [marked.js](https://marked.js.org/) for Markdown parsing
- Color scheme inspired by Argn Framework

## License

This project is open source and available under the same license as Argn.

## Support

For issues, suggestions, or contributions, please open an issue in the repository.

---

**Start building your encyclopedia today!** 🚀
