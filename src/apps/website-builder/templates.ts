export type WebsiteTemplateId = 'blank' | 'personal' | 'blog' | 'portfolio' | 'company' | 'landing';

export interface WebsiteTemplate {
  id: WebsiteTemplateId;
  name: string;
  description: string;
}

export const WEBSITE_TEMPLATES: WebsiteTemplate[] = [
  { id: 'blank', name: 'Blank', description: 'An empty page to build from scratch' },
  { id: 'personal', name: 'Personal', description: 'A simple personal homepage' },
  { id: 'blog', name: 'Blog', description: 'A blog with a couple of posts' },
  { id: 'portfolio', name: 'Portfolio', description: 'Showcase a few projects' },
  { id: 'company', name: 'Company', description: 'A small business landing page' },
  { id: 'landing', name: 'Landing Page', description: 'A single call-to-action page' },
];

const STYLE = `body { font-family: system-ui, sans-serif; margin: 0; padding: 3rem 2rem; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
h1 { color: #38bdf8; }
a { color: #38bdf8; }
.card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
${body}
</body>
</html>
`;
}

export function generateTemplate(templateId: WebsiteTemplateId, domain: string): { indexHtml: string; styleCss: string } {
  const styleCss = STYLE;
  switch (templateId) {
    case 'personal':
      return {
        styleCss,
        indexHtml: page(
          domain,
          `<h1>Hi, I'm the owner of ${domain}</h1>
  <div class="card"><p>Welcome to my little corner of the Virtual Internet.</p></div>`,
        ),
      };
    case 'blog':
      return {
        styleCss,
        indexHtml: page(
          `${domain} - Blog`,
          `<h1>${domain}</h1>
  <div class="card"><h2>First post</h2><p>This is the first post on this virtual blog.</p></div>
  <div class="card"><h2>Second post</h2><p>Another update from inside Computer Simulator.</p></div>`,
        ),
      };
    case 'portfolio':
      return {
        styleCss,
        indexHtml: page(
          `${domain} - Portfolio`,
          `<h1>Portfolio</h1>
  <div class="card"><h2>Project One</h2><p>A short description of the first project.</p></div>
  <div class="card"><h2>Project Two</h2><p>A short description of the second project.</p></div>`,
        ),
      };
    case 'company':
      return {
        styleCss,
        indexHtml: page(
          domain,
          `<h1>${domain}</h1>
  <div class="card"><p>We build things inside the Virtual Internet.</p></div>
  <div class="card"><h2>Contact</h2><p>Reach us at hello@${domain}</p></div>`,
        ),
      };
    case 'landing':
      return {
        styleCss,
        indexHtml: page(
          domain,
          `<h1>${domain}</h1>
  <div class="card"><p>One page. One goal.</p><p><a href="#">Get started</a></p></div>`,
        ),
      };
    case 'blank':
    default:
      return { styleCss, indexHtml: page(domain, `<h1>${domain}</h1>\n  <p>Start building here.</p>`) };
  }
}
