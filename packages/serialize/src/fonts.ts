export const BUNDLED_FONTS = [
  { file: 'IBMPlexSans-Regular.ttf', family: 'IBM Plex Sans', weight: 400, style: 'normal' },
  { file: 'IBMPlexSans-Medium.ttf', family: 'IBM Plex Sans', weight: 500, style: 'normal' },
  { file: 'IBMPlexSans-SemiBold.ttf', family: 'IBM Plex Sans', weight: 600, style: 'normal' },
  { file: 'IBMPlexSans-Bold.ttf', family: 'IBM Plex Sans', weight: 700, style: 'normal' },
  { file: 'IBMPlexSans-Italic.ttf', family: 'IBM Plex Sans', weight: 400, style: 'italic' },
  { file: 'IBMPlexSans-BoldItalic.ttf', family: 'IBM Plex Sans', weight: 700, style: 'italic' },
  { file: 'IBMPlexMono-Regular.ttf', family: 'IBM Plex Mono', weight: 400, style: 'normal' },
] as const;

export function embedSvgFonts(svg: string, base64: readonly string[], license: string): string {
  const css = BUNDLED_FONTS.map((font, index) =>
    `@font-face{font-family:'${font.family}';font-weight:${font.weight};font-style:${font.style};src:url(data:font/ttf;base64,${base64[index]}) format('truetype')}`,
  ).join('\n');
  const notice = license.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return svg.replace(/(<svg[^>]*>)/, `$1\n<metadata id="oc-font-license">${notice}</metadata>\n<style>${css}</style>`);
}

export function plexPdfFont(family: string, bold: boolean, italic: boolean): string {
  return /mono|consolas|cascadia/i.test(family) ? 'IBMPlexMono-Regular.ttf'
    : `IBMPlexSans-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}.ttf`;
}
