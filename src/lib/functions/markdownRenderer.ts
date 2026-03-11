// thanks to the goat Claude Sonnet 4.6 for this masterpiece
// and also a ton of the code because you aint catching me spending
// years working on a feature btw.
// i need someway to get rid of my dev burnout and realistically
// we only have two people anyway so gotta start GRINDING.
// ELI PLEASE DONT FLAME MEEEEEEEE
export function markdownToSafeHTML(input: string): string {
    if (typeof input !== "string") return "";

    // --- Step 1: Escape raw HTML to prevent XSS ---
    const escapeHTML = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

    // Escape everything first
    let html = escapeHTML(input);

    // --- Step 2: Convert Markdown to HTML ---

    // Headings (### h3, ## h2, # h1)
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Horizontal rule (--- or ***)
    html = html.replace(/^(?:---|\*\*\*)\s*$/gm, "<hr>");

    // Blockquotes (> text)
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

    // Code blocks (``` ... ```)
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);

    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    html = html.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");

    // Bold (**text** or __text__)
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // Italic (*text* or _text_)
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

    // Strikethrough (~~text~~)
    html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

    // Images (before links, to avoid conflict): ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');

    // Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Unordered lists (- item or * item)
    html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");

    // Ordered lists (1. item)
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ol>$1</ol>");

    // Paragraphs: wrap lines not already in a block tag
    const blockTags = /^<(h[1-6]|ul|ol|li|pre|blockquote|hr)/;
    html = html
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return "";
            if (blockTags.test(trimmed)) return trimmed;
            return `<p>${trimmed}</p>`;
        })
        .filter((line) => line !== "")
        .join("\n");

    return html;
}
