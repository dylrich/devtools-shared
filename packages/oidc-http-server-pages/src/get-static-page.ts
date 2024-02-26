import type { ITemplate, HttpServerPage } from './types';
import templates from './templates.json';

function findTemplate(templates: ITemplate[], parameterKeys: string[]) {
  const parametersJoined = parameterKeys.sort().join('-');
  for (const template of templates) {
    const templateParametersJoined = Object.keys(template.parameters)
      .sort()
      .join('-');
    if (parametersJoined === templateParametersJoined) return template;
  }
}

function replacePlaceholders(
  template: ITemplate,
  parameters: Record<string, string | undefined>
) {
  let { html } = template;
  for (const [key, placeholder] of Object.entries(template.parameters)) {
    html = html.replaceAll(placeholder, escapeHTML(parameters[key] as string));
  }
  return html;
}

function escapeHTML(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getStaticPage(
  page: HttpServerPage,
  parameters: Record<string, string | undefined>
) {
  const pageTemplates = templates[page];
  const nonEmptyParameters = Object.keys(parameters).filter(
    (key) => typeof parameters[key] !== 'undefined' && parameters !== null
  );
  const template = findTemplate(pageTemplates, nonEmptyParameters);
  if (!template) return; // TODO: handle missing template
  const html = replacePlaceholders(template, parameters);
  return html;
}