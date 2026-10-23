const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
const cssPath = path.join(__dirname, 'style.css');
const jsPath = path.join(__dirname, 'app.js');
const outputPath = path.join(__dirname, 'mockup-standalone.html');

let html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

// Replace CSS link with inline style
html = html.replace(
  '<link rel="stylesheet" href="style.css">',
  `<style>\n${css}\n</style>`
);

// Replace JS script tag with inline script
html = html.replace(
  '<script src="app.js"></script>',
  `<script>\n${js}\n</script>`
);

fs.writeFileSync(outputPath, html, 'utf8');
console.log('Successfully generated mockup-standalone.html');
