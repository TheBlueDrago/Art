// The owner's admin page. It's an empty shell; /assets/admin.js builds the
// screens and talks to /api/admin. Nothing private is in this HTML.

export function adminShell() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Store admin</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/admin.css?v=1">
<script src="/assets/admin.js?v=1" defer></script>
</head>
<body>
<div id="app" class="boot"><div class="spinner" aria-label="Loading"></div></div>
<div id="toasts" aria-live="polite"></div>
</body>
</html>`;
}
