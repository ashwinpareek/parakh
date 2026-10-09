// Turns the single-file Vite build into an artifact page (content without <html>/<head>/<body>,
// which the host adds) and lists the sample files that must be published next to it.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const html = readFileSync('dist-single/index.html', 'utf8');
// Slice by position: the bundle itself contains strings like "<title>" and "<style", so never regex the whole file.
const headEnd = html.lastIndexOf('</head>');
const scriptStart = html.indexOf('<script type="module"');
const scriptEnd = html.lastIndexOf('</script>', headEnd) + '</script>'.length;
const pre = html.slice(0, scriptStart);
const title = pre.match(/<title>[\s\S]*?<\/title>/)[0];
const links = [...pre.matchAll(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g)].map((m) => m[0]);
const post = html.slice(scriptEnd, headEnd);
const style = post.slice(post.indexOf('<style'), post.lastIndexOf('</style>') + '</style>'.length);
const script = html.slice(scriptStart, scriptEnd);
const page = [title, ...links, style, '<div id="root"></div>', script].join('\n');
const scripts = [script], styles = [style];
writeFileSync('dist-single/artifact.html', page);
const files = ['samples/manifest.json', 'samples/gstr2b_092026.json', 'samples/purchase_register.csv', 'samples/reference_extractions.json', 'samples/ground_truth.json', ...readdirSync('public/samples/invoices').map((f) => `samples/invoices/${f}`)];
writeFileSync('dist-single/files.json', JSON.stringify(Object.fromEntries(files.map((f) => [f, `dist-single/${f}`])), null, 1));
console.log('artifact.html', (page.length / 1e6).toFixed(2), 'MB;', scripts.length, 'scripts,', styles.length, 'styles');
