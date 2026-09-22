import { describe, expect, it } from 'vitest';
import { sandboxHtml } from '../internet/web/sandbox';

describe('sandboxHtml', () => {
  it('injects a CSP meta tag and console bridge right after <head>', () => {
    const html = '<html><head><title>x</title></head><body>hi</body></html>';
    const out = sandboxHtml(html);
    expect(out).toContain('Content-Security-Policy');
    expect(out).toContain('virtual-internet-console');
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'));
  });

  it('blocks real network access via connect-src none', () => {
    const out = sandboxHtml('<html><head></head><body></body></html>');
    expect(out).toMatch(/connect-src 'none'/);
  });

  it('still injects into a document with no <head> tag', () => {
    const out = sandboxHtml('<html><body>hi</body></html>');
    expect(out).toContain('Content-Security-Policy');
  });

  it('degrades gracefully for a body-only fragment with no <html> tag', () => {
    const out = sandboxHtml('<h1>hi</h1>');
    expect(out).toContain('Content-Security-Policy');
    expect(out).toContain('<h1>hi</h1>');
  });
});
