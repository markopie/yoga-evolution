import { defineConfig } from 'vite';
import { authoredCourseSections } from './src/config/authoredCourseSources.js';

// Embed the same reviewed lesson identities used by search in the reference
// page. The deployed page can then be read offline without JavaScript or a login.
function courseLessonLists(sourceKey) {
  const sectionsByCourse = new Map();
  for (const section of authoredCourseSections.filter(item => item.sourceKey === sourceKey)) {
    if (!sectionsByCourse.has(section.id)) sectionsByCourse.set(section.id, []);
    sectionsByCourse.get(section.id).push(section);
  }
  if (!sectionsByCourse.size) throw new Error('Missing book mapping: ' + sourceKey);
  const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Array.from(sectionsByCourse, ([id, sections]) => {
    const lists = sections.map(section => {
      const heading = sections.length > 1 ? '<h4>' + escapeText(section.section) + '</h4>' : '';
      const lessons = section.lessons.map(([lessonId, title]) =>
        '<li>' + escapeText(title) + ' <span class="id">#' + lessonId + '</span></li>');
      return heading + '<ul class="lessons">' + lessons.join('') + '</ul>';
    });
    return '<h3 id="map-' + id + '">' + escapeText(sections[0].course) + ' · catalogue lessons</h3>' + lists.join('');
  }).join('\n');
}

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: ['index.html', 'course-sources.html'] } },
  plugins: [{
    name: 'course-source-lists',
    transformIndexHtml(html, context) {
      if (context.path !== '/course-sources.html') return html;
      return html.replace(/<!-- catalogue:([a-z_]+) -->/g, (_, sourceKey) => courseLessonLists(sourceKey));
    },
  }],
  server: { watch: { ignored: ['**/.runtime/**', '**/playwright-report/**', '**/test-results/**'] } },
  // Remote-browser test runs reach the Playwright preview through a tunnel hostname.
  preview: {
    allowedHosts: process.env.PLAYWRIGHT_PREVIEW === '1' ? ['.loca.lt', '.trycloudflare.com'] : [],
  },
});

