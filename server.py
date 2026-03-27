#!/usr/bin/env python3
"""
Single-Page Application (SPA) HTTP Server
Serves index.html for all non-existent routes, allowing client-side routing
"""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


class SPAHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Custom HTTP handler that serves index.html for unknown routes (SPA mode)"""
    
    def do_GET(self):
        # Normalize path and remove query string
        path = self.path.split('?')[0]
        
        # List of file extensions that are actual files (not routes)
        file_extensions = ['.js', '.css', '.json', '.html', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot']
        
        # Check if path is requesting a file
        is_asset = any(path.lower().endswith(ext) for ext in file_extensions)
        
        # Check if file exists
        file_path = Path(self.translate_path(path))
        file_exists = file_path.exists() and file_path.is_file()
        
        # If it's an asset request
        if is_asset:
            if file_exists:
                return super().do_GET()
            else:
                # File doesn't exist - return 404
                self.send_error(404)
                return
        
        # For non-asset requests (routes), check if file exists
        if file_exists:
            return super().do_GET()
        
        # Not a file and file doesn't exist -> serve index.html for SPA routing
        self.path = '/index.html'
        return super().do_GET()
    
    def end_headers(self):
        # Add cache headers to prevent stale content
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def log_message(self, format, *args):
        # Enhanced logging
        if args[0] == 200:
            print(f'✓ {self.client_address[0]} - {format%args}')
        else:
            print(f'⚠ {self.client_address[0]} - {format%args}')


def run_server(port=8080):
    """Start the SPA server"""
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    server_address = ('', port)
    httpd = HTTPServer(server_address, SPAHTTPRequestHandler)
    
    print(f'🌐 Gifsk Wiki SPA Server running on http://localhost:{port}')
    print(f'📂 Serving from: {os.getcwd()}')
    print(f'📄 Routes:')
    print(f'   / (home)')
    print(f'   /all-articles')
    print(f'   /categories')
    print(f'   /recent')
    print(f'   /category/article-slug (e.g., /gifstad/overview)')
    print(f'\n✓ Server ready. Press Ctrl+C to stop.\n')
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n\n👋 Server stopped.')
        sys.exit(0)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run_server(port)
